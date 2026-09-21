import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { execFile, spawn } from "child_process";
import { dirname, join } from "path";
import { existsSync, mkdirSync, openSync } from "fs";
import { promisify } from "util";

const execFileP = promisify(execFile);

export interface ShutdownResult {
  ok: boolean;
  started: boolean;
}

/**
 * Lives on the local machine (like the app itself), so it can shut the whole
 * system down the way the old stop.bat used to. It finds the project root via
 * git, then launches the platform's stop ENGINE as a separate process:
 *
 *   Windows   -> installer\engine\stop.ps1 -StopDatabase
 *   macOS/Linux -> installer/macos/scripts/stop.sh
 *
 * The engine kills the API and web watchers by port, and on Windows also
 * shuts down the project's own portable PostgreSQL cluster (.postgres\data).
 * The HTTP response is sent first; a second later this process dies with
 * everything else.
 *
 * IMPORTANT — spawn() must NOT use `detached: true` with `stdio: "ignore"`:
 * on Windows that combination leaves the PowerShell engine frozen before it
 * prints a single line (the stop never happens, the button appears dead).
 * The engine is spawned without detaching and writes its console output to
 * logs\shutdown-<timestamp>.log instead — proven to run to completion.
 */
@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);

  constructor(private readonly config: ConfigService) {}

  async shutdown(): Promise<ShutdownResult> {
    const root = await this.projectRoot();
    if (!root) return { ok: false, started: false };

    const isWindows = process.platform === "win32";
    const script = isWindows
      ? "installer\\engine\\stop.ps1"
      : "installer/macos/scripts/stop.sh";

    try {
      if (isWindows) {
        const psArgs = [
          "-NoLogo",
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          script,
          "-StopDatabase",
        ];
        const logFd = this.openOutput(root, "shutdown");
        spawn(
          process.env.SystemRoot
            ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
            : "powershell.exe",
          psArgs,
          { cwd: root, stdio: ["ignore", logFd, logFd], windowsHide: true },
        ).unref();
      } else {
        spawn("/bin/sh", [script], { cwd: root, detached: true, stdio: "ignore" }).unref();
      }
      this.logger.log(`Shutdown engine launched: ${script}`);
      return { ok: true, started: true };
    } catch (e) {
      this.logger.error(`Could not launch the shutdown engine: ${(e as Error).message}`);
      return { ok: false, started: false };
    }
  }

  /** Open a file handle for the engine's console output, one per run. */
  private openOutput(root: string, kind: string) {
    const logsDir = join(root, "logs");
    mkdirSync(logsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return openSync(join(logsDir, `${kind}-${stamp}.log`), "a");
  }

  /**
   * Locates the project root WITHOUT depending on git: an installed release
   * has no .git directory (the installer ships files, not a clone), and a
   * machine running the servers from plain command lines has no git either —
   * a null here used to make the Shut Down button silently do nothing.
   * Strategy: walk up from __dirname to the dir containing
   * pnpm-workspace.yaml (the same marker the stop engines use), falling back
   * to the compiled layout's known depth, then git as a last resort.
   */
  private async projectRoot(): Promise<string | null> {
    // 1. Walk up from this file's location. dist/system/system.service.js
    //    (build) or src/system/system.service.ts (watch mode) — both are two
    //    levels below the backend package, which sits in apps/backend.
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    // 2. Known monorepo shape, in case the marker file is missing.
    const candidate = join(__dirname, "..", "..", "..");
    if (existsSync(join(candidate, "apps")) && existsSync(join(candidate, "installer"))) return candidate;

    // 3. Git as a last resort (dev checkouts always have it).
    try {
      const { stdout } = await execFileP("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        timeout: 10_000,
      });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }
}