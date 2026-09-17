/**
 * Minimal keyed async mutex for single-instance check-then-write paths
 * (schedule entry create / series edit).
 *
 * The conflict check reads, then the insert writes: two requests interleaved
 * between the two both pass the check and both write a double booking. The
 * partial unique indexes cannot express "no overlapping effective ranges",
 * so same-key operations are serialised here, FIFO per key. Different keys
 * never block each other.
 *
 * Single-instance only — like the login throttle and the KPI cache, this
 * install runs exactly one backend. A concurrent `reconcile` on another
 * replica would not observe it; `scanAll` remains the detector of last
 * resort for those.
 */
const tails = new Map<string, Promise<void>>();

export async function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  tails.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    // Keep the map bounded: drop the tail once it drains with nobody queued.
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
  }
}
