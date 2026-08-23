import { CloudSetupService } from "../setup/setup.service";

/**
 * `verify()` is pure orchestration over two collaborators, so it is tested
 * with hand-rolled doubles rather than a live database.
 */
function makeService(opts: {
  targets: Array<{ id: string; last_error: string | null; last_success_at: Date | null }>;
  queuePending: number;
  drained: boolean;
}): CloudSetupService {
  const db = {
    client: {
      select: () => ({ from: () => ({ where: () => Promise.resolve(opts.targets) }) }),
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
  const worker = { runDrainNow: async () => opts.drained };
  return new CloudSetupService(
    db as never,
    {} as never, // keys
    {} as never, // creds
    worker as never,
    {} as never, // snapshots
    {} as never, // registry
    queue as never,
  );
}

describe("setup verification", () => {
  it("reports ok when the queue is drained and every target succeeded", async () => {
    const service = makeService({
      targets: [{ id: "t1", last_error: null, last_success_at: new Date() }],
      queuePending: 0,
      drained: true,
    });
    const result = await service.verify();
    expect(result.pending).toBe(0);
    expect(result.ok).toBe(true);
  });

  it("counts pending SYNC QUEUE rows, not configured targets", async () => {
    // Two healthy targets, empty queue. The old code returned pending = 2
    // (the target count) and could never report ok.
    const service = makeService({
      targets: [
        { id: "t1", last_error: null, last_success_at: new Date() },
        { id: "t2", last_error: null, last_success_at: new Date() },
      ],
      queuePending: 0,
      drained: true,
    });
    const result = await service.verify();
    expect(result.pending).toBe(0);
    expect(result.ok).toBe(true);
  });

  it("is not ok while rows are still queued", async () => {
    const service = makeService({
      targets: [{ id: "t1", last_error: null, last_success_at: new Date() }],
      queuePending: 7,
      drained: true,
    });
    const result = await service.verify();
    expect(result.pending).toBe(7);
    expect(result.ok).toBe(false);
  });

  it("is not ok when a target reported an error", async () => {
    const service = makeService({
      targets: [{ id: "t1", last_error: "boom", last_success_at: null }],
      queuePending: 0,
      drained: true,
    });
    expect((await service.verify()).ok).toBe(false);
  });

  it("is not ok when there are no targets at all", async () => {
    const service = makeService({ targets: [], queuePending: 0, drained: false });
    expect((await service.verify()).ok).toBe(false);
  });
});
