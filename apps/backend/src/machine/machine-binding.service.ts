import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Anti-copy protection: this project is bound to the computer it was first
 * started on. The binding lives in `machine.lock` at the repo root and holds a
 * SHA256 of the Windows MachineGuid - a per-installation identifier that never
 * travels with the files. Copying the whole folder to a USB drive therefore
 * yields a working folder on a machine whose fingerprints disagree, and the
 * backend refuses to start.
 *
 * This is a deterrent for casual copying, not DRM: the source is on GitHub.
 * Legitimate re-binding (new computer) is done by the manager deleting
 * `machine.lock`; the next start re-binds to the machine it runs on.
 *
 * On non-Windows systems (macOS/Linux dev boxes, WSL) the check is skipped:
 * MachineGuid only exists on Windows.
 */
@Injectable()
export class MachineBindingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MachineBindingService.name);
  private readonly lockFileName = "machine.lock";

  onApplicationBootstrap() {
    if (process.platform !== "win32") {
      this.logger.warn("Machine binding skipped (non-Windows host)");
      return;
    }

    const machineId = this.readMachineId();
    if (!machineId) {
      this.logger.warn("Cannot read the machine identifier (registry MachineGuid) - binding check skipped");
      return;
    }

    const lockPath = this.lockFilePath();
    if (!existsSync(lockPath)) {
      writeFileSync(lockPath, machineId, { encoding: "ascii" });
      this.logger.log("machine.lock created - this project is now bound to this computer");
      return;
    }

    const stored = readFileSync(lockPath, "ascii").trim().toLowerCase();
    if (stored === machineId) {
      this.logger.log("Machine binding verified (machine.lock)");
      return;
    }

    this.logger.error(
      "This copy of the project is bound to a different computer. " +
        "Copying the project to another machine is not allowed. " +
        "The backend will refuse to start. (To legitimately move it, delete machine.lock at the project root.)",
    );
    process.exit(1);
  }

  /** SHA256 of the Windows MachineGuid (HKLM\SOFTWARE\Microsoft\Cryptography). */
  private readMachineId(): string | null {
    try {
      const out = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v "MachineGuid"',
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
      );
      const match = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
      if (!match) return null;
      return createHash("sha256").update(match[1].trim().toLowerCase()).digest("hex");
    } catch {
      return null;
    }
  }

  /** The machine.lock file lives at the monorepo root, next to pnpm-workspace.yaml. */
  private lockFilePath(): string {
    let dir = process.cwd();
    for (let i = 0; i < 10; i++) {
      if (existsSync(join(dir, "pnpm-workspace.yaml"))) return join(dir, this.lockFileName);
      const parent = join(dir, "..");
      if (parent === dir) return join(dir, this.lockFileName);
      dir = parent;
    }
    return join(dir, this.lockFileName);
  }
}