import { createHash, createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/**
 * A key that is bound to this machine, used to encrypt the on-disk credential
 * store (the fallback path where no OS keychain is available).
 *
 * On Windows it is derived from the MachineGuid registry value — the same
 * identifier the project already uses for `machine.lock` — so the key never
 * travels with the files and a copied folder cannot decrypt its own
 * credentials on another machine. On macOS/Linux it derives from
 * /etc/machine-id (or the system hostid as a last resort).
 */

const MACHINE_ID_REGISTRY = "HKLM\\SOFTWARE\\Microsoft\\Cryptography";
const MACHINE_ID_VALUE = "MachineGuid";

export function machineId(): string | null {
  if (process.platform === "win32") {
    try {
      const out = execFileSync(
        "reg",
        ["query", MACHINE_ID_REGISTRY, "/v", MACHINE_ID_VALUE],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 10_000 },
      );
      const match = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
      if (match) return match[1].trim().toLowerCase();
      return null;
    } catch {
      return null;
    }
  }
  for (const file of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      if (existsSync(file)) {
        const id = readFileSync(file, "utf8").trim();
        if (id) return id.toLowerCase();
      }
    } catch {
      /* continue */
    }
  }
  try {
    const hostid = execFileSync("hostid", { encoding: "utf8", timeout: 5_000 }).trim();
    if (hostid) return hostid.toLowerCase();
  } catch {
    /* continue */
  }
  return null;
}

/** 32-byte machine-bound key. Deterministic for the life of the install. */
export function machineKey(): Buffer | null {
  const id = machineId();
  if (!id) return null;
  return createHash("sha256").update(id).digest();
}

/**
 * Derives a per-store key with a random salt so the same machine key never
 * encrypts two credential files the same way.
 */
export function deriveStoreKey(machineKey: Buffer, salt: Buffer): Buffer {
  return createHmac("sha256", machineKey)
    .update("iq-cloud-credentials-v1")
    .update(salt)
    .digest();
}

/** Generate a stable per-boot process nonce guard (never persisted). */
export function freshSalt(): Buffer {
  return randomBytes(16);
}