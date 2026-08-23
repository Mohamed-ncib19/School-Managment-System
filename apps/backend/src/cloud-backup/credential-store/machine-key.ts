import { createHash, createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";

/**
 * A key that is bound to this installation, used to encrypt the on-disk
 * credential store and to wrap the cloud master key.
 *
 * On Windows it derives from the MachineGuid registry value — the same
 * identifier the project already uses for `machine.lock` — so the key never
 * travels with the files and a copied folder cannot decrypt its own
 * credentials on another machine. On macOS/Linux it derives from
 * /etc/machine-id. Where neither exists (containers), a random identity is
 * generated once and persisted next to the credentials it protects.
 */

const MACHINE_ID_REGISTRY = "HKLM\\SOFTWARE\\Microsoft\\Cryptography";
const MACHINE_ID_VALUE = "MachineGuid";

/** File name of the generated identity, inside the credential directory. */
export const MACHINE_KEY_FILE = "machine-key";

let cached: string | null = null;

/** Test seam: forget the memoised identity. */
export function resetMachineIdCache(): void {
  cached = null;
}

function fromWindowsRegistry(): string | null {
  if (process.platform !== "win32") return null;
  try {
    const out = execFileSync("reg", ["query", MACHINE_ID_REGISTRY, "/v", MACHINE_ID_VALUE], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: 10_000,
    });
    const match = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
    return match ? match[1].trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

function fromSystemFiles(): string | null {
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
  return null;
}

/**
 * Last resort: a random identity generated once and persisted next to the
 * credentials it protects.
 *
 * A container has no stable host identity — `node:22-alpine` ships no
 * `/etc/machine-id` and no `hostid`, so this used to return null, `save()`
 * and `wrapFromPhrase()` threw, and cloud backup could not be configured in
 * Docker at all. Where the identity comes from the host, a copied folder
 * cannot decrypt its credentials elsewhere; where it comes from this file,
 * that property is provided by the volume the file lives on. Neither is a
 * secret that travels with a git clone — this path is inside `.cloud-creds/`,
 * which is git- and docker-ignored.
 */
function fromPersistedFile(dir: string): string {
  const path = join(dir, MACHINE_KEY_FILE);
  try {
    if (existsSync(path)) {
      const id = readFileSync(path, "utf8").trim();
      if (id.length >= 32) return id.toLowerCase();
    }
  } catch {
    /* regenerate below */
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const generated = randomBytes(32).toString("hex");
  writeFileSync(path, generated, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows ignores POSIX modes; the directory ACL covers it */
  }
  return generated;
}

/**
 * A stable identifier for this installation. Prefers the OS machine identity
 * (Windows MachineGuid, then /etc/machine-id) and falls back to a persisted
 * random value in `fallbackDir` when one is given.
 */
export function machineId(fallbackDir?: string): string | null {
  if (cached) return cached;
  const found = fromWindowsRegistry() ?? fromSystemFiles();
  if (found) {
    cached = found;
    return cached;
  }
  if (!fallbackDir) return null;
  cached = fromPersistedFile(fallbackDir);
  return cached;
}

/** 32-byte machine-bound key. Deterministic for the life of the install. */
export function machineKey(fallbackDir?: string): Buffer | null {
  const id = machineId(fallbackDir);
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
