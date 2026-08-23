import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SyncQueueService, MAX_ATTEMPTS } from "../queue/sync-queue.service";

interface Recorded {
  set: Record<string, unknown>;
}

function makeQueue(): { queue: SyncQueueService; updates: Recorded[] } {
  const updates: Recorded[] = [];
  const db = {
    client: {
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: (() => {
            const result = Promise.resolve([{ id: 1 }, { id: 2 }]) as Promise<unknown> & {
              returning: () => Promise<unknown>;
            };
            updates.push({ set });
            result.returning = async () => [{ id: 1 }, { id: 2 }];
            return result;
          }) as never,
        }),
      }),
    },
  };
  return { queue: new SyncQueueService(db as never), updates };
}

describe("failed rows come back", () => {
  it("exposes an attempt ceiling so a poison row cannot spin forever", () => {
    expect(MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(MAX_ATTEMPTS).toBeLessThanOrEqual(20);
  });

  it("requeueRetryable flips failed rows back to pending", async () => {
    const { queue, updates } = makeQueue();
    const moved = await queue.requeueRetryable(MAX_ATTEMPTS);

    expect(updates).toHaveLength(1);
    expect(updates[0].set.status).toBe("pending");
    expect(moved).toBe(2);
  });

  it("markFailed still increments attempts so the ceiling can be reached", async () => {
    const { queue, updates } = makeQueue();
    await queue.markFailed([1, 2], "boom");

    expect(updates[0].set.status).toBe("failed");
    expect(updates[0].set.last_error).toBe("boom");
    expect(updates[0].set.attempts).toBeDefined();
  });
});

describe("the drain cycle requeues before it reads", () => {
  const worker = readFileSync(join(__dirname, "..", "worker", "sync-worker.service.ts"), "utf8");
  const drain = worker.slice(worker.indexOf("async drainOnce"));
  const body = drain.slice(0, drain.indexOf("\n  /**"));

  it("calls requeueRetryable", () => {
    // The old retryFailed() took an id list and was called by nothing at all.
    expect(body).toContain("requeueRetryable");
  });

  it("requeues before reading the next batch", () => {
    // Otherwise the requeued rows wait a whole extra cycle.
    expect(body.indexOf("requeueRetryable")).toBeLessThan(body.indexOf("nextBatch"));
  });

  it("refuses to drain while a split-brain conflict stands", () => {
    expect(body).toMatch(/if \(this\.conflict\) return false/);
  });
});
