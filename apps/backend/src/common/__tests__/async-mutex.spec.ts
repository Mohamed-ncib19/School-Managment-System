import { runExclusive } from "../async-mutex";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("runExclusive", () => {
  it("serialises same-key tasks FIFO with max concurrency 1", async () => {
    const order: string[] = [];
    let active = 0;
    let peak = 0;
    const task = (name: string) => () =>
      (async () => {
        active++;
        peak = Math.max(peak, active);
        order.push(`start:${name}`);
        await tick();
        await tick();
        order.push(`end:${name}`);
        active--;
        return name;
      })();

    const results = await Promise.all([
      runExclusive("room:A", task("one")),
      runExclusive("room:A", task("two")),
      runExclusive("room:A", task("three")),
    ]);

    expect(results).toEqual(["one", "two", "three"]);
    expect(peak).toBe(1);
    expect(order).toEqual([
      "start:one",
      "end:one",
      "start:two",
      "end:two",
      "start:three",
      "end:three",
    ]);
  });

  it("lets different keys run independently", async () => {
    const seen = new Set<string>();
    const both = await Promise.all([
      runExclusive("room:A", async () => {
        seen.add("a");
        return "a";
      }),
      runExclusive("room:B", async () => {
        seen.add("b");
        return "b";
      }),
    ]);
    expect(both).toEqual(["a", "b"]);
    expect(seen).toEqual(new Set(["a", "b"]));
  });

  it("propagates errors and releases the key", async () => {
    await expect(
      runExclusive("room:C", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(runExclusive("room:C", async () => "after")).resolves.toBe("after");
  });
});
