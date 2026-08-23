import { Injectable, Logger } from "@nestjs/common";
import { createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { machineKey, deriveStoreKey, freshSalt } from "./machine-key";

/**
 * Credential storage for the cloud backup targets.
 *
 * Primary path: the OS keychain / credential manager. On Windows this is the
 * Credential Manager via DPAPI (invoked through PowerShell, which is present
 * on every supported Windows install); the blob is user+machine scoped, so it
 * can only be decrypted by the same user on the same computer — exactly the
 * property a machine-bound secret needs.
 *
 * Fallback path (macOS/Linux hosts, or when PowerShell/DPAPI is unavailable):
 * an app config file under `.cloud-creds/`, encrypted with AES-256-GCM using a
 * key derived from the machine fingerprint (MachineGuid / /etc/machine-id).
 * File permissions are locked to the current user (0600, or an ACL on
 * Windows) and never loosened.
 *
 * Secrets are never rendered back to the UI: callers only receive `hasSecret`
 * flags for masking, and a replace action overwrites the entry.
 */
@Injectable()
export class CredentialStoreService {
  private readonly logger = new Logger(CredentialStoreService.name);
  private readonly dir: string;
  private readonly useDpapi: boolean;

  constructor() {
    const root = this.projectRoot();
    this.dir = join(root, ".cloud-creds");
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    }
    this.useDpapi = process.platform === "win32";
  }

  private projectRoot(): string {
    let dir = process.cwd();
    for (let i = 0; i < 10; i++) {
      if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
      const parent = join(dir, "..");
      if (parent === dir) return dir;
      dir = parent;
    }
    return dir;
  }

  /** True when a secret is stored for this entry (never the secret itself). */
  has(entryId: string): boolean {
    return existsSync(this.path(entryId));
  }

  private path(entryId: string): string {
    // entryId is a UUID (cloud_targets.config_ref) — safe as a file name.
    return join(this.dir, `${entryId}.enc`);
  }

  async save(entryId: string, secretJson: string): Promise<void> {
    const file = this.path(entryId);
    const salt = freshSalt();
    if (this.useDpapi) {
      try {
        const blob = await this.dpapiProtect(secretJson);
        writeFileSync(file, `DPAPI1\n${salt.toString("base64")}\n${blob}`, { encoding: "utf8", mode: 0o600 });
        await this.lockdown(file);
        return;
      } catch (err) {
        this.logger.warn(`DPAPI unavailable, falling back to machine-key file: ${(err as Error).message}`);
      }
    }
    const key = machineKey();
    if (!key) {
      throw new Error(
        "Impossible de dériver une clé liée à la machine — aucun identifiant machine lisible. " +
          "La sauvegarde cloud ne peut pas stocker ses identifiants en sécurité.",
      );
    }
    const storeKey = deriveStoreKey(key, salt);
    const nonce = freshSalt().subarray(0, 12);
    const cipher = createCipheriv("aes-256-gcm", storeKey, nonce);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(secretJson, "utf8")), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([salt, nonce, tag, encrypted]);
    writeFileSync(file, Buffer.concat([Buffer.from("IQCB1\n"), payload]), { encoding: "binary", mode: 0o600 });
    this.lockdown(file);
  }

  async load(entryId: string): Promise<string | null> {
    const file = this.path(entryId);
    if (!existsSync(file)) return null;
    try {
      const raw = readFileSync(file);
      if (raw.subarray(0, 6).toString("ascii") === "DPAPI1") {
        const [, , blob] = raw.toString("utf8").split("\n");
        if (!blob) throw new Error("Bad DPAPI credential record");
        return await this.dpapiUnprotect(blob.trim());
      }
      const header = raw.subarray(0, 6).toString("ascii");
      if (header !== "IQCB1\n") throw new Error("Unknown credential file format");
      const payload = raw.subarray(6);
      const salt = payload.subarray(0, 16);
      const nonce = payload.subarray(16, 28);
      const tag = payload.subarray(28, 44);
      const encrypted = payload.subarray(44);
      const key = machineKey();
      if (!key) throw new Error("No machine key available");
      const storeKey = deriveStoreKey(key, salt);
      const decipher = createDecipheriv("aes-256-gcm", storeKey, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    } catch (err) {
      this.logger.error(
        `Impossible de lire les identifiants de la destination ${entryId} : ${(err as Error).message}. ` +
          "Cette destination sera ignorée par la sauvegarde tant que ses identifiants ne sont pas ressaisis.",
      );
      return null;
    }
  }

  async delete(entryId: string): Promise<void> {
    const file = this.path(entryId);
    if (existsSync(file)) {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(file);
    }
  }

  private async lockdown(file: string): Promise<void> {
    try {
      if (process.platform === "win32") {
        // Restrict to the current user via icacls; removing inheritance first
        // prevents the Administrators-everyone default ACL from lingering.
        const { execFileSync } = await import("node:child_process");
        execFileSync("icacls", [file, "/inheritance:r", "/grant:r", `${process.env.USERNAME}:F`], {
          windowsHide: true,
          stdio: "ignore",
        });
      } else {
        chmodSync(file, 0o600);
      }
    } catch (err) {
      this.logger.warn(`Could not lock down permissions on ${file}: ${(err as Error).message}`);
    }
  }

  private async dpapiProtect(plaintext: string): Promise<string> {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileP = promisify(execFile);
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$b64 = '" + Buffer.from(plaintext, "utf8").toString("base64") + "'",
      "$secure = ConvertTo-SecureString $b64 -AsPlainText -Force",
      "$enc = ConvertFrom-SecureString $secure",
      "[Console]::Out.Write($enc)",
    ].join("; ");
    const { stdout } = await execFileP(
      process.env.SystemRoot
        ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
        : "powershell.exe",
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { encoding: "utf8", windowsHide: true, timeout: 30_000 },
    );
    if (!stdout) throw new Error("Empty DPAPI output");
    return stdout.trim();
  }

  private async dpapiUnprotect(blob: string): Promise<string> {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileP = promisify(execFile);
    const escaped = blob.replace(/'/g, "''");
    const script = [
      "$ErrorActionPreference = 'Stop'",
      // ConvertTo-SecureString is the inverse of the ConvertFrom-SecureString
      // used in dpapiProtect. Calling ConvertFrom here (as this did) meant
      // every DPAPI-stored credential saved fine and could never be read
      // back — targets silently vanished from the sync worker.
      `$secure = ConvertTo-SecureString '${escaped}'`,
      "$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
      // try/finally must be ONE element: the join below inserts "; " between
      // elements, and `try { } ; finally { }` is a PowerShell parser error
      // (MissingCatchOrFinally) — which failed every unprotect on its own,
      // independently of the ConvertFrom/ConvertTo mixup above it.
      "try { [Console]::Out.Write([System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)) } finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }",
    ].join("; ");
    const { stdout } = await execFileP(
      process.env.SystemRoot
        ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
        : "powershell.exe",
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { encoding: "utf8", windowsHide: true, timeout: 30_000 },
    );
    if (!stdout) throw new Error("Empty DPAPI output");
    return Buffer.from(stdout.trim(), "base64").toString("utf8");
  }
}