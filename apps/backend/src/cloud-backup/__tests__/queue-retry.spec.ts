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

describe("export covers the queue, then trims it", () => {
  const snapshot = readFileSync(join(__dirname, "..", "worker", "snapshot.service.ts"), "utf8");

  it("prunes the queue through the landed export sequence", () => {
    // No event batches ship anymore: each export carries the full dataset,
    // so rows at or below its sequence are covered and trimmed.
    expect(snapshot).toContain("pruneThrough");
  });

  it("purges legacy snapshot/event/manifest prefixes after a good export", () => {
    expect(snapshot).toContain("purgeLegacyPrefixes");
    expect(snapshot).toContain("LEGACY_PREFIXES");
  });

  it("never shells out to pg_dump", () => {
    expect(snapshot).not.toContain("pg_dump");
    expect(snapshot).not.toContain("dumpToFile");
  });
});
