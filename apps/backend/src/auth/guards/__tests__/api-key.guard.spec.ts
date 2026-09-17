import { ApiKeyGuard } from "../api-key.guard";

const ctxFor = (method: string, path: string, headers: Record<string, unknown> = {}) =>
  ({
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => ({ method, path, headers }) }),
  }) as never;

const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    prev[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(env)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
};

const codeOf = (fn: () => void): { status: number; code: string } => {
  try {
    fn();
    return { status: 200, code: "OK" };
  } catch (err: any) {
    const body = err.getResponse?.() as any;
    return { status: err.getStatus?.() ?? 500, code: body?.code ?? "?" };
  }
};

describe("ApiKeyGuard", () => {
  it("lets key-free routes through with no key and no school name", () => {
    withEnv({ SCHOOL_NAME: undefined, API_KEY: undefined }, () => {
      const guard = new ApiKeyGuard();
      for (const [method, path] of [
        ["GET", "/api/health"],
        ["POST", "/api/auth/login"],
        ["POST", "/api/auth/refresh"],
        ["POST", "/api/auth/logout"],
        ["GET", "/api/updates"],
        ["GET", "/api/updates/progress"],
        ["GET", "/api/system-settings"],
        ["GET", "/api/financial/settings/logo"],
        ["GET", "/api/cloud-backup/oauth/dropbox/callback"],
        ["GET", "/api/cloud-backup/restore/oauth/gdrive/url"],
      ] as const) {
        expect(guard.canActivate(ctxFor(method, path))).toBe(true);
      }
    });
  });

  it("answers 503 SETUP_REQUIRED before the school name exists", () => {
    withEnv({ SCHOOL_NAME: undefined, API_KEY: "k" }, () => {
      expect(codeOf(() => new ApiKeyGuard().canActivate(ctxFor("GET", "/api/users")))).toEqual({
        status: 503,
        code: "SETUP_REQUIRED",
      });
    });
  });

  it("answers 503 when the server key is not configured", () => {
    withEnv({ SCHOOL_NAME: "School", API_KEY: undefined }, () => {
      expect(
        codeOf(() => new ApiKeyGuard().canActivate(ctxFor("GET", "/api/users", { "x-api-key": "k" }))),
      ).toEqual({ status: 503, code: "API_KEY_NOT_CONFIGURED" });
    });
  });

  it("answers 401 INVALID_API_KEY for a missing or wrong key", () => {
    withEnv({ SCHOOL_NAME: "School", API_KEY: "correct" }, () => {
      const guard = new ApiKeyGuard();
      expect(codeOf(() => guard.canActivate(ctxFor("GET", "/api/users")))).toEqual({
        status: 401,
        code: "INVALID_API_KEY",
      });
      expect(
        codeOf(() => guard.canActivate(ctxFor("GET", "/api/users", { "x-api-key": "wrong" }))),
      ).toEqual({ status: 401, code: "INVALID_API_KEY" });
    });
  });

  it("lets the right key through", () => {
    withEnv({ SCHOOL_NAME: "School", API_KEY: "correct" }, () => {
      expect(
        new ApiKeyGuard().canActivate(ctxFor("GET", "/api/users", { "x-api-key": "correct" })),
      ).toBe(true);
    });
  });

  it("still requires the key on JWT routes (me, restore start)", () => {
    withEnv({ SCHOOL_NAME: "School", API_KEY: "correct" }, () => {
      const guard = new ApiKeyGuard();
      for (const [method, path] of [
        ["GET", "/api/auth/me"],
        ["POST", "/api/cloud-backup/restore/start"],
        ["POST", "/api/updates/apply"],
      ] as const) {
        expect(codeOf(() => guard.canActivate(ctxFor(method, path)))).toEqual({
          status: 401,
          code: "INVALID_API_KEY",
        });
      }
    });
  });
});
