import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRetryable } from "../drivers/retry-policy";
import { withRetry } from "../drivers/storage-driver";
import { S3Driver } from "../drivers/s3.driver";

describe("retry policy", () => {
  it("does not retry authentication failures", () => {
    expect(isRetryable({ name: "InvalidAccessKeyId" })).toBe(false);
    expect(isRetryable({ name: "SignatureDoesNotMatch" })).toBe(false);
    expect(isRetryable({ $metadata: { httpStatusCode: 403 } })).toBe(false);
    expect(isRetryable({ response: { status: 401 } })).toBe(false);
  });

  it("does not retry a missing bucket or folder", () => {
    expect(isRetryable({ name: "NoSuchBucket" })).toBe(false);
    expect(isRetryable({ $metadata: { httpStatusCode: 404 } })).toBe(false);
  });

  it("retries transient network and server failures", () => {
    expect(isRetryable(new Error("ETIMEDOUT"))).toBe(true);
    expect(isRetryable(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryable({ $metadata: { httpStatusCode: 503 } })).toBe(true);
    expect(isRetryable({ $metadata: { httpStatusCode: 429 } })).toBe(true);
  });

  it("retries an unrecognised error rather than giving up on it", () => {
    expect(isRetryable(new Error("something unfamiliar"))).toBe(true);
  });
});

describe("withRetry", () => {
  it("gives up immediately on a permanent failure", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw { name: "InvalidAccessKeyId", message: "bad key" };
        },
        { maxRetries: 4, backoffBaseMs: 1, backoffMaxMs: 2, timeoutMs: 1_000 },
      ),
    ).rejects.toBeDefined();
    // Four pointless retries at a 30s timeout was two and a half minutes
    // before the setup wizard could report a typo'd key.
    expect(attempts).toBe(1);
  });

  it("keeps retrying a transient failure up to the ceiling", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("ETIMEDOUT");
        },
        { maxRetries: 3, backoffBaseMs: 1, backoffMaxMs: 2, timeoutMs: 1_000 },
      ),
    ).rejects.toThrow(/ETIMEDOUT/);
    expect(attempts).toBe(4); // first try + 3 retries
  });

  it("returns the value once a retry succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("ECONNRESET");
        return "ok";
      },
      { maxRetries: 4, backoffBaseMs: 1, backoffMaxMs: 2, timeoutMs: 1_000 },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });
});

describe("S3 driver", () => {
  const config = {
    endpoint: "https://s3.example.com",
    region: "us-east-1",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret",
    bucket: "bucket",
    addressing: "path" as const,
  };

  it("reuses one client instead of constructing one per call", () => {
    const driver = new S3Driver(config);
    const first = (driver as unknown as { client(): unknown }).client();
    const second = (driver as unknown as { client(): unknown }).client();
    expect(second).toBe(first);
    (driver as unknown as { destroy(): void }).destroy();
  });

  it("exposes a destroy hook so sockets are released", () => {
    const driver = new S3Driver(config);
    expect(typeof (driver as unknown as { destroy?: () => void }).destroy).toBe("function");
  });
});

const source = (name: string) => readFileSync(join(__dirname, "..", "drivers", name), "utf8");

describe("gdrive driver source", () => {
  const gdrive = source("gdrive.driver.ts");

  it("tests the connection against the real school folder, not a __probe__ one", () => {
    expect(gdrive).not.toContain('rootFolder(auth, "__probe__")');
  });

  it("no longer carries the dead no-op files.update call", () => {
    expect(gdrive).not.toContain("media: undefined as never");
  });

  it("caches the resolved folder id", () => {
    expect(gdrive).toContain("resolvedFolderId");
  });
});

describe("webdav driver source", () => {
  const webdav = source("webdav.driver.ts");

  it("either implements caPath or does not advertise it", () => {
    const advertises = webdav.includes("caPath");
    const noOp = webdav.includes("{ httpAgent: undefined }");
    expect(advertises && noOp).toBe(false);
  });

  it("honours the overwrite option so the registry can be rewritten", () => {
    expect(webdav).toContain("opts?.overwrite");
  });
});
