import { CloudSetupService } from "../setup/setup.service";

/**
 * `verify()` probes every enabled target live (write/read round trip) and
 * stamps the bookkeeping from the outcome — it must not read bookkeeping
 * that a fresh setup never wrote, or step 2 fails every target with no
 * message. Tested with hand-rolled doubles rather than a live database.
 */
function makeService(opts: {
  probe: "ok" | "fail";
  targetIds?: string[];
  queuePending: number;
  drained: boolean;
}) {
  const ids = opts.targetIds ?? ["t1"];
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    client: {
      select: () => ({ from: () => ({ where: async () => ids.map((id) => ({ id })) }) }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            updates.push(values);
          },
        }),
      }),
    },
  };
  const queue = {
    stats: async () => ({
      pending: opts.queuePending,
      failed: 0,
      total: 0,
      oldestPendingAt: null,
      pendingBytes: 0,
    }),
  };
  const worker = {
    runDrainNow: async () => opts.drained,
    enabledTargets: async () => [
      {
        id: "t1",
        driver: {
          testConnection: async () => {
            if (opts.probe === "fail") throw new Error("boom");
            return { ok: true as const, latencyMs: 1, probe: "p" };
          },
        },
      },
    ],
  };
  const service = new CloudSetupService(
    db as never,
    {} as never, // keys
    {} as never, // creds
    worker as never,
    {} as never, // snapshots
    {} as never, // registry
    queue as never,
  );
  return { service, updates };
}

describe("setup verification", () => {
  it("probes the target live and reports ok on success", async () => {
    const { service, updates } = makeService({ probe: "ok", queuePending: 0, drained: true });
    const result = await service.verify();
    expect(result.pending).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.targets).toEqual([{ id: "t1", ok: true, lastError: null }]);
    expect(updates.some((u) => u.last_error === null && u.last_success_at instanceof Date)).toBe(true);
  });

  it("stamps the provider message on failure instead of an empty failure", async () => {
    const { service, updates } = makeService({ probe: "fail", queuePending: 0, drained: true });
    const result = await service.verify();
    expect(result.ok).toBe(false);
    expect(result.targets).toEqual([{ id: "t1", ok: false, lastError: "boom" }]);
    expect(updates.some((u) => u.last_error === "boom")).toBe(true);
  });

  it("is not ok while rows are still queued", async () => {
    const { service } = makeService({ probe: "ok", queuePending: 7, drained: true });
    const result = await service.verify();
    expect(result.pending).toBe(7);
    expect(result.ok).toBe(false);
  });

  it("is not ok when there are no targets at all", async () => {
    const { service } = makeService({ probe: "ok", targetIds: [], queuePending: 0, drained: false });
    expect((await service.verify()).ok).toBe(false);
  });
});
