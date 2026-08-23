import { latestPerInstance, InstanceRecord } from "../registry/instance-registry.service";
import { InstanceRegistryService } from "../registry/instance-registry.service";
import { Readable } from "node:stream";
import type { StorageDriver } from "../drivers/storage-driver";

function rec(uuid: string, claimedAt: string, status: "active" | "retired"): InstanceRecord {
  return { instance_uuid: uuid, hostname: `host-${uuid.slice(0, 4)}`, claimed_at: claimedAt, status };
}

function memoryDriver(initial: Record<string, Buffer> = {}): StorageDriver & { store: Record<string, Buffer> } {
  const store = initial;
  const driver = {
    id: "s3" as const,
    displayName: "mem",
    store,
    async testConnection() {
      return { ok: true as const, latencyMs: 1, probe: "mem" };
    },
    async put(key: string, stream: Readable, sizeHint?: number) {
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
      store[key] = Buffer.concat(chunks);
      return { key, size: sizeHint ?? 0 };
    },
    async get(key: string) {
      const buf = store[key];
      if (!buf) throw new Error("Object not found");
      return Readable.from([buf]);
    },
    async list(prefix: string) {
      return Object.keys(store)
        .filter((k) => k.startsWith(prefix))
        .map((k) => ({ key: k, size: store[k].length, lastModified: null }));
    },
  } as unknown as StorageDriver & { store: Record<string, Buffer> };
  return driver;
}

describe("latestPerInstance", () => {
  it("returns the newest record per instance", () => {
    const records = [
      rec("a", "2026-01-01T00:00:00Z", "active"),
      rec("a", "2026-01-02T00:00:00Z", "retired"),
      rec("b", "2026-01-03T00:00:00Z", "active"),
    ];
    const latest = latestPerInstance(records);
    expect(latest).toHaveLength(2);
    const a = latest.find((r) => r.instance_uuid === "a");
    expect(a?.status).toBe("retired");
  });
});

describe("InstanceRegistryService", () => {
  const service = new InstanceRegistryService();

  it("claims a new instance without conflict", async () => {
    const driver = memoryDriver();
    const result = await service.claim(driver, "ecole-test", "11111111-1111-1111-1111-111111111111", "pc-1");
    expect(result.ok).toBe(true);
    expect(result.conflict).toBeNull();
  });

  it("detects a second active instance (split-brain)", async () => {
    const driver = memoryDriver();
    await service.claim(driver, "ecole-test", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "pc-1");
    const second = await service.claim(driver, "ecole-test", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "pc-2");
    expect(second.ok).toBe(false);
    expect(second.conflict?.instance_uuid).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  });

  it("clears the conflict once the other instance retires", async () => {
    const driver = memoryDriver();
    await service.claim(driver, "ecole-test", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "pc-1");
    await service.retire(driver, "ecole-test", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    const second = await service.claim(driver, "ecole-test", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "pc-2");
    expect(second.ok).toBe(true);
  });

  it("refuses a registry for the wrong school id", async () => {
    const driver = memoryDriver();
    await service.claim(driver, "ecole-a", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "pc-1");
    await expect(service.read(driver, "ecole-b")).resolves.toBeNull();
  });
});