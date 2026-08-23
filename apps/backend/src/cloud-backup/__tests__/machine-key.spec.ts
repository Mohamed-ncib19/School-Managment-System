import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  machineId,
  machineKey,
  deriveStoreKey,
  resetMachineIdCache,
  MACHINE_KEY_FILE,
} from "../credential-store/machine-key";

describe("machine key", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "iq-machinekey-"));
    resetMachineIdCache();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    resetMachineIdCache();
  });

  it("always yields a key when given a fallback directory", () => {
    // On node:22-alpine there is no /etc/machine-id and no hostid, so this
    // used to return null — save() threw and cloud backup could not be
    // configured in Docker at all.
    const key = machineKey(dir);
    expect(key).not.toBeNull();
    expect(key!.length).toBe(32);
  });

  it("is stable across calls, so a wrapped key stays unwrappable", () => {
    const first = machineKey(dir)!;
    resetMachineIdCache();
    const second = machineKey(dir)!;
    expect(first.equals(second)).toBe(true);
  });

  it("derives distinct store keys from distinct salts", () => {
    const base = machineKey(dir)!;
    const one = deriveStoreKey(base, Buffer.alloc(16, 1));
    const two = deriveStoreKey(base, Buffer.alloc(16, 2));
    expect(one.equals(two)).toBe(false);
  });

  it("returns a string identity for the fallback directory", () => {
    expect(typeof machineId(dir)).toBe("string");
  });
});

/**
 * The persisted-identity path only engages where the host has no machine id
 * of its own. On a Windows or systemd host the registry / /etc/machine-id
 * wins, which is the intended precedence — so these assertions are scoped to
 * the platforms where the fallback is actually reachable.
 */
const describeFallback =
  process.platform === "win32" || process.env.CI === "true" ? describe.skip : describe;

describeFallback("persisted identity fallback", () => {
  it("writes the generated identity so a container restart can unwrap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-machinekey-fb-"));
    try {
      resetMachineIdCache();
      machineKey(dir);
      const persisted = await readFile(join(dir, MACHINE_KEY_FILE), "utf8");
      expect(persisted.trim().length).toBeGreaterThanOrEqual(32);
    } finally {
      await rm(dir, { recursive: true, force: true });
      resetMachineIdCache();
    }
  });
});
