import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { execFile, spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { promisify } from "util";

const execFileP = promisify(execFile);

export interface UpdateStatus {
  /** True when the GitHub repository reports a commit this install doesn't have. */
  available: boolean;
  repo?: string;
  branch?: string;
  installed?: { short: string; branch: string };
  latest?: { sha: string; short: string; message: string; author: string; date: string };
  checkedAt: string;
  /** When the check can't run: disabled, no-git-install, no-github-remote, github-unreachable. */
  reason?: string;
}

/**
 * Mirror of the progress journal the update engines write
 * (installer\engine\do-update.ps1 / installer/macos/scripts/update.sh).
 */
export interface UpdateProgress {
  state: "idle" | "running" | "done" | "failed" | "stalled";
  step?: number;
  stepTotal?: number;
  label?: string;
  message?: string;
  updatedAt?: string;
}

interface Cached {
  at: number;
  status: UpdateStatus;
}

/**
 * The app is distributed as a git clone (see installer\engine\do-update.ps1),
 * so the "installed version" IS the local HEAD commit and "latest" means the
 * upstream repository on GitHub is ahead. The repo and owner are discovered from
 * the install's own git config — nothing is hard-coded — and the tracked branch
 * is `UPDATE_BRANCH` (default: the install's current branch, then "main"). Each
 * school install gets the same `UPDATE_BRANCH=selfhosted` when the school rollout
 * follows a dedicated release branch. GITHUB_TOKEN is required whenever the
 * release repository is private.
 *
 * Public repos work without a token (subject to GitHub's unauthenticated rate
 * limit of 60 requests/hour). Private repos always return 404 to unauthenticated
 * requests, so GITHUB_TOKEN must be set to a classic PAT or fine-grained token
 * with at least `Contents: Read` on the repository.
 *
 * The backend exposes:
 *   GET  /api/updates               -> UpdateStatus (??refresh=1 bypasses the cache)
 *   GET  /api/updates/progress      -> live engine state (logs\update-progress.json)
 *   POST /api/updates/apply         -> spawns the platform's update engine detached
 */
@Injectable()
export class UpdatesService {
  private readonly logger = new Logger(UpdatesService.name);
  private cache: Cached | null = null;

  constructor(private readonly config: ConfigService) {}

  async getStatus(force = false): Promise<UpdateStatus> {
    const minutes = this.cacheMinutes();
    if (minutes <= 0) {
      return { available: false, checkedAt: new Date().toISOString(), reason: "disabled" };
    }

    if (!force && this.cache && Date.now() - this.cache.at < minutes * 60_000) return this.cache.status;

    const status = await this.buildStatus();
    // Transient failures (no internet, GitHub down) retry on the next poll.
    this.cache = status.reason ? null : { at: Date.now(), status };
    return status;
  }

  /** Compare local HEAD with the upstream HEAD and report which one is newer. */
  private async buildStatus(): Promise<UpdateStatus> {
    const base: UpdateStatus = { available: false, checkedAt: new Date().toISOString() };

    const localSha = await this.git(["rev-parse", "HEAD"]);
    if (!localSha) return { ...base, reason: "no-git-install" };

    const branch = this.trackedBranch();
    const remote = await this.resolveRemoteRepo();
    if (!remote) return { ...base, reason: "no-github-remote" };
    const repo = `${remote.owner}/${remote.repo}`;

    const latest = await this.fetchLatestCommit(remote.owner, remote.repo, branch);
    if (!latest) return { ...base, repo, branch, reason: "github-unreachable" };

    return {
      available: latest.sha !== localSha,
      repo,
      branch,
      installed: { short: localSha.slice(0, 7), branch },
      latest,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Launch the platform's update engine in its own visible console (Windows)
   * that stops the servers, pulls, installs, migrates and restarts on its own.
   * The HTTP response is sent before the engine gets round to stopping this
   * process.
   *
   * The engine must NOT inherit the backend's console: the API runs in a
   * minimized window, which would hide the whole progress flow. `cmd /c start`
   * therefore gives the engine a fresh console the moment it launches, with
   * its native output mirrored to logs\update-<timestamp>.log for later
   * inspection (PowerShell's Write-Host UI stays on the new window). Like the
   * shutdown engine, do NOT spawn it detached with `stdio: "ignore"` — that
   * combination freezes PowerShell on Windows.
   */
  async applyUpdate(): Promise<{ ok: boolean; started: boolean }> {
    const root = await this.git(["rev-parse", "--show-toplevel"]);
    if (!root) return { ok: false, started: false };

    const isWindows = process.platform === "win32";
    const script = isWindows
      ? "installer\\engine\\do-update.ps1"
      : "installer/macos/scripts/update.sh";

    try {
      if (isWindows) {
        const logFile = this.openLog(root, "update");
        const ps = process.env.SystemRoot
          ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
          : "powershell.exe";
        const updateCmd =
          `start "SCHOOL MANAGEMENT SYSTEM - Update" /D "${root}" ` +
          `"${ps}" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "${script}" ` +
          `>> "${logFile}" 2>&1`;
        spawn("cmd.exe", ["/d", "/c", updateCmd], {
          cwd: root,
          stdio: "ignore",
          windowsHide: false,
        }).unref();
      } else {
        spawn("/bin/sh", [script], { cwd: root, detached: true, stdio: "ignore" }).unref();
      }
      this.logger.log(`Update engine launched: ${script}`);
      return { ok: true, started: true };
    } catch (e) {
      this.logger.error(`Could not launch the update engine: ${(e as Error).message}`);
      return { ok: false, started: false };
    }
  }

  /**
   * Path of a fresh timestamped log file under logs\ for the engine output. */
  private openLog(root: string, kind: string): string {
    const logsDir = join(root, "logs");
    mkdirSync(logsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return join(logsDir, `${kind}-${stamp}.log`);
  }

  /**
   * Current state of the update engine as reported by its progress journal
   * (logs\update-progress.json, written by the engines while they run). A
   * "running" journal that has not been refreshed for a while means the
   * engine left a stale file behind (or was killed) - reported as "stalled".
   */
  async getProgress(): Promise<UpdateProgress> {
    const root = await this.git(["rev-parse", "--show-toplevel"]);
    if (!root) return { state: "idle" };
    const file = join(root, "logs", "update-progress.json");
    if (!existsSync(file)) return { state: "idle" };
    try {
      const raw = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
      const progress = JSON.parse(raw) as UpdateProgress;
      if (progress.state === "running") {
        const ageMs = Date.now() - statSync(file).mtimeMs;
        if (ageMs > 20 * 60_000) return { ...progress, state: "stalled" };
      }
      return progress;
    } catch {
      return { state: "idle" };
    }
  }

  /** stdout of a git command, trimmed, ornull when git itself is missing. */
  private async git(args: string[]): Promise<string | null> {
    try {
      const { stdout } = await execFileP("git", args, { encoding: "utf8", timeout: 10_000 });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /** Extract owner/repo from the configured remote (https:// or git@…). */
  private async resolveRemoteRepo(): Promise<{ owner: string; repo: string } | null> {
    const url = await this.git(["config", "--get", "remote.origin.url"]);
    if (!url) return null;
    const m = url.match(/(?:github\.com(?::|\/))([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!m) return null;
    return { owner: m[1], repo: m[2] };
  }

  private async fetchLatestCommit(owner: string, repo: string, branch: string) {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}?per_page=1`;
    const token = this.config.get<string>("GITHUB_TOKEN")?.trim();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "iq-academy-updater",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        if (res.status === 404) {
          this.logger.warn(
            "GitHub API 404 — the repository is private or does not exist. " +
              "Set GITHUB_TOKEN in apps/backend/.env to a token with repo read access.",
          );
        } else if (res.status !== 403) {
          this.logger.warn(`GitHub API ${res.status} — check the repo visibility / token.`);
        }
        return null;
      }
      const body: unknown = await res.json();
      const item = Array.isArray(body) ? body[0] : (body as any);
      if (!item?.sha) return null;
      return {
        sha: String(item.sha),
        short: String(item.sha).slice(0, 7),
        message: String(item.commit?.message?.split("\n")[0] ?? "update"),
        author: String(item.commit?.author?.name ?? "unknown"),
        date: String(item.commit?.author?.date ?? ""),
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private cacheMinutes(): number {
    const raw = Number(this.config.get<string>("UPDATE_CHECK_MINUTES") ?? 60);
    return Number.isFinite(raw) ? raw : 60;
  }

  /**
   * The GitHub branch this install tracks — always the `selfhosted` release
   * branch. `UPDATE_BRANCH` in apps/backend/.env can pin a school to another
   * branch, but the default is never the local branch or `main`: every school
   * install updates from the same release branch.
   */
  private trackedBranch(): string {
    return this.config.get<string>("UPDATE_BRANCH")?.trim() || "selfhosted";
  }
}