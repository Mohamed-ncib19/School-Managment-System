import { of } from "rxjs";
import { TransformInterceptor } from "../interceptors/transform.interceptor";

const run = (payload: unknown): Promise<any> =>
  new Promise((resolve) => {
    new TransformInterceptor()
      .intercept({} as never, { handle: () => of(payload) })
      .subscribe(resolve);
  });

describe("TransformInterceptor", () => {
  it("wraps a plain object payload", async () => {
    await expect(run({ a: 1 })).resolves.toEqual({
      data: { a: 1 },
      meta: undefined,
      error: null,
    });
  });

  it("passes a {data,meta} page through untouched", async () => {
    await expect(run({ data: [1, 2], meta: { total: 2 } })).resolves.toEqual({
      data: [1, 2],
      meta: { total: 2 },
      error: null,
    });
  });

  it("wraps arrays as payload rather than reading them as envelopes", async () => {
    await expect(run(["a", "b"])).resolves.toEqual({
      data: ["a", "b"],
      meta: undefined,
      error: null,
    });
  });

  it("wraps null and primitives", async () => {
    await expect(run(null)).resolves.toEqual({ data: null, meta: undefined, error: null });
    await expect(run("ok")).resolves.toEqual({ data: "ok", meta: undefined, error: null });
  });
});
