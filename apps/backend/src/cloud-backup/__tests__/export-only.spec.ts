import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { SnapshotService } from "../worker/snapshot.service";
import { makeSchoolSalt } from "../crypto/kdf";
import { MemoryDriver } from "./support/memory-driver";

/**
 * Export-only backups: one versioned data_export per run, legacy prefixes
 * purged, queue trimmed through the landed sequence.
 */
function makeService(driver: MemoryDriver) {
  const manifests: Array<Record<string, unknown>> = [];
  const targetUpdates: Array<Record<string, unknown>> = [];
  let prunedThrough = -1;
  const db = {
    client: {
      select: () => ({ from: async () => [{ m: 5 }] }),
      insert: () => ({
        values: (values: Record<string, unknown>) => ({
          onConflictDoNothing: async () => {
            manifests.push(values);
          },
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            targetUpdates.push(values);
          },
        }),
      }),
    },
  };
  const queue = {
    pruneThrough: async (seq: number) => {
      prunedThrough = seq;
      return 3;
    },
  };
  const dataTransfer = {
    exportAll: async () => ({ buffer: Buffer.from('{"tables":{}}'), filename: "x.json" }),
  };
  const service = new SnapshotService(db as never, queue as never, dataTransfer as never);
  const seed = async (key: string) => {
    await driver.put(key, Readable.from([Buffer.from("legacy")]), 6, { overwrite: true });
  };
  return { service, manifests, targetUpdates, seed, prunedThrough: () => prunedThrough };
}

describe("export-only runSnapshot", () => {
  it("uploads one single replaced file and nothing else", async () => {
    const driver = new MemoryDriver();
    const { service } = makeService(driver);
    const key = randomBytes(32);
    const results = await service.runSnapshot(
      [{ id: "t1", driver }],
      key,
      "school1",
      makeSchoolSalt(),
      "test",
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ targetId: "t1", ok: true });
    const keys = driver.keys().filter((k) => !k.startsWith("__iq_probe__"));
    expect(keys).toEqual(["school1/exports/latest.json.zst.enc"]);
  });

  it("purges legacy prefixes but keeps meta and other schools", async () => {
    const driver = new MemoryDriver();
    const { service, manifests, targetUpdates, seed, prunedThrough } = makeService(driver);
    await seed("school1/snapshots/2026-01-01_0000000001_aaa.sql.zst.enc");
    await seed("school1/events/2026-01-01/1-2.jsonl.zst.enc");
    await seed("school1/manifests/2026-01-01.json.enc");
    await seed("school1/meta/salt.json");
    await seed("school2/snapshots/other.sql.zst.enc");

    const results = await service.runSnapshot(
      [{ id: "t1", driver }],
      randomBytes(32),
      "school1",
      makeSchoolSalt(),
      "test",
    );
    expect(results[0].ok).toBe(true);

    const keys = driver.keys();
    expect(keys.some((k) => k.startsWith("school1/snapshots/"))).toBe(false);
    expect(keys.some((k) => k.startsWith("school1/events/"))).toBe(false);
    expect(keys.some((k) => k.startsWith("school1/manifests/"))).toBe(false);
    expect(keys).toContain("school1/meta/salt.json");
    expect(keys).toContain("school2/snapshots/other.sql.zst.enc");
    expect(keys.some((k) => k.startsWith("school1/exports/"))).toBe(true);

    expect(manifests.length).toBeGreaterThan(0);
    expect(manifests.every((m) => m.kind === "data_export")).toBe(true);
    expect(targetUpdates.some((u) => u.last_success_at instanceof Date)).toBe(true);
    expect(prunedThrough()).toBe(6);
  });
});
