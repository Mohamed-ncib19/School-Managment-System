import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { execFile, spawn } from "child_process";
import { promisify } from "util";

const execFileP = promisify(execFile);

export interface ShutdownResult {
  ok: boolean;
  started: boolean;
}

/**
 * Lives on the local machine (like the app itself), so it can shut the whole
 * system down the way the old stop.bat used to. It finds the project root via
 * git, then launches the platform's stop ENGINE as a detached process:
 *
 *   Windows   -> tools\windows\scripts\stop.ps1 -StopDatabase
 *   macOS/Linux -> tools/macos/scripts/stop.sh
 *
 * The engine kills the API and web watchers by port, and on Windows also
 * shuts down the project's own portable PostgreSQL cluster (.postgres\data).
 * The HTTP response is sent first; a second later this process dies with
 * everything else.
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
      ? "tools\\windows\\scripts\\stop.ps1"
      : "tools/macos/scripts/stop.sh";

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
        spawn(
          process.env.SystemRoot
            ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
            : "powershell.exe",
          psArgs,
          { cwd: root, detached: true, stdio: "ignore" },
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

  private async projectRoot(): Promise<string | null> {
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