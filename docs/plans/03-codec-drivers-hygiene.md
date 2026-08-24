# Cloud Backup Remediation — Part 3

Continues `01-blockers-and-security.md` (Tasks 1–8) and `02-sync-durability.md` (Tasks 9–14).
This part covers Tasks 15–22, the deferred verification protocol, and the coverage matrix.

---

## Deferred verification protocol

**This section overrides every "Step N: Run the test to verify it fails/passes" step in Parts 1 and 2.**

Running `npx jest` in this repo compiles all 179 backend TypeScript files through `ts-jest`, which type-checks each one in a worker process. That is minutes of CPU and gigabytes of RAM for a suite whose guards are pure functions over buffers and strings. Doing it after every step — roughly forty times across this plan — is the single largest cost in the whole effort, and it buys nothing that one run at the end does not.

So: **write the tests, do not run them.** Each task's test steps become *author the test file* and *author the fix*. Verification happens once, in Task 22, through a purpose-built runner that costs a fraction of the default.

### Why this is safe

The guards in this plan are deliberately cheap and hermetic — no database, no network, no Nest bootstrap. They are pure assertions over buffers, regexes, hand-rolled doubles, and (for a few) the source text of the file being fixed. A test like that either compiles and passes or compiles and fails; there is no flakiness to catch early, and nothing about running it sooner makes the fix better. The one genuine risk of batching — a later task silently breaking an earlier task's guard — is exactly what a single full-suite run at the end catches, and catches better than per-step runs would.

The type system is the fast feedback loop instead. `tsc --noEmit` over the whole backend takes seconds and already caught nothing on the current tree, which is precisely why every one of these forty findings is a *silent runtime* bug. Run it after each task; run jest once.

### Per-task loop (use this instead of the printed test steps)

```bash
cd "D:/School Management System/apps/backend"
npx tsc --noEmit -p tsconfig.json     # seconds, single process, catches signature drift
```

That is the whole per-task check. If it exits 0, commit and move to the next task.

### Task 15: Build the guard runner

Do this **before** Task 16, so the runner exists when Task 22 needs it. It is the cheapest task in the plan and the one that pays for the rest.

**Files:**
- Create: `apps/backend/jest.guards.config.js`
- Modify: `apps/backend/package.json` (scripts)
- Modify: `apps/backend/tsconfig.json` (only if `isolatedModules` is absent — see step 3)

**Closes:** nothing from the findings list; this is the instrument the rest of the plan is verified with.

- [ ] **Step 1: Create the guards config**

Create `apps/backend/jest.guards.config.js`:

```javascript
/**
 * Fast guard suite.
 *
 * The default jest config (inline in package.json) sweeps all 179 backend
 * files through ts-jest, which type-checks every one of them in a worker.
 * That is the right thing for a full CI run and the wrong thing for the
 * regression guards in docs/plans/, which are hermetic unit tests over
 * buffers and strings.
 *
 * Two changes carry the speedup:
 *
 *  - `isolatedModules: true` transpiles instead of type-checking. Types are
 *    still enforced — by `npx tsc --noEmit`, one process for the whole
 *    project, which is far cheaper than N workers each rebuilding a program.
 *  - `roots` narrows collection to the guard directories, so no unrelated
 *    spec is compiled at all.
 *
 * Run with `pnpm test:guards`. Run the full suite with `pnpm test` when you
 * actually want the full suite.
 */
module.exports = {
  rootDir: "src",
  moduleFileExtensions: ["js", "json", "ts"],
  testEnvironment: "node",
  roots: ["<rootDir>/cloud-backup/__tests__", "<rootDir>/common/__tests__"],
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": ["ts-jest", { isolatedModules: true }],
  },
  // Bound the blast radius on a school-spec laptop.
  maxWorkers: 2,
  // A hermetic guard that takes longer than this is doing I/O it should not.
  testTimeout: 30_000,
};
```

- [ ] **Step 2: Add the scripts**

In `apps/backend/package.json`, add to `scripts`:

```json
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test:guards": "jest -c jest.guards.config.js",
    "verify": "pnpm typecheck && pnpm test:guards",
```

And in the **root** `package.json`, add:

```json
    "verify": "pnpm -C apps/backend run verify",
```

so the whole gate is one command from anywhere in the repo.

- [ ] **Step 3: Make `isolatedModules` legal**

`isolatedModules: true` rejects a few TypeScript constructs — most commonly `export { SomeType }` where `SomeType` is a type-only export. Check:

```bash
cd "D:/School Management System/apps/backend"
npx tsc --noEmit -p tsconfig.json --isolatedModules
```

If it reports `Re-exporting a type when 'isolatedModules' is enabled requires using 'export type'`, fix each site by adding the `type` keyword — e.g. in `cloud-backup.module.ts`, `export { MachineBindingService }` is a value export and is fine, but any `export { SomeInterface }` becomes `export type { SomeInterface }`.

- [ ] **Step 4: Confirm the runner works on the tests that exist today**

This is the one jest invocation before Task 22, and it runs three small files:

```bash
pnpm test:guards
```

Expected: the three pre-existing cloud-backup specs (`crypto`, `instance-registry`, `redaction`) run and pass in a few seconds. If `crypto.spec.ts` fails on `encoded.stream`, Task 3 has already landed and its step 6 was skipped — apply it now.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/jest.guards.config.js apps/backend/package.json package.json
git commit -m "chore: add a fast guard suite runner separate from the full jest sweep"
```

---

## Phase 4 — Codec correctness

### Task 16: Fix the object codec's four defects

**Closes:** F16 (`stored_bytes` is always `0` in the stored header), F17 (every object is compressed twice), F19 (a corrupt object crashes the process instead of rejecting), F37 (the GCM decrypt transform buffers without bound).

F18 (double `.end()`) was already closed by Task 3's rewrite of `openStream`.

**Files:**
- Modify: `apps/backend/src/cloud-backup/crypto/object-codec.ts`
- Modify: `apps/backend/src/cloud-backup/crypto/cipher.ts:80-120` (`GcmDecryptTransform`)
- Create: `apps/backend/src/cloud-backup/__tests__/codec-integrity.spec.ts`

**Interfaces:**
- Produces: `MAX_FRAME_BYTES` exported from `cipher.ts` (value `16 * 1024 * 1024`).
- `encodeObject`'s signature is unchanged; `prepass` now returns the compressed records it produced so the upload pass can reuse them.

- [ ] **Step 1: Author the guard**

Create `apps/backend/src/cloud-backup/__tests__/codec-integrity.spec.ts`:

```typescript
import { Readable } from "node:stream";
import { buildKdfParams, deriveKey, newSalt } from "../crypto/kdf";
import { encodeObject, decodeObject } from "../crypto/object-codec";
import { splitObject } from "../crypto/object-header";
import { compressionAlgorithm } from "../crypto/compression";
import { GcmDecryptTransform, MAX_FRAME_BYTES, newNonceBase } from "../crypto/cipher";

const TEST_KDF = buildKdfParams("scrypt", newSalt(), { scryptN: 1024 });
const PAYLOAD = Buffer.from("x".repeat(300_000), "utf8");

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function build(key: Buffer) {
  return encodeObject({
    schoolId: "ecole-test",
    objectKey: "ecole-test/snapshots/2026-08-23_0000000001.sql.zst.enc",
    kind: "snapshot",
    kdf: TEST_KDF,
    key,
    compression: compressionAlgorithm(),
    plaintext: () => Readable.from([PAYLOAD]),
  });
}

describe("stored object header", () => {
  it("records the real wire size, not zero", async () => {
    const key = await deriveKey("phrase", TEST_KDF);
    const object = await build(key);
    const bytes = await collect(object.openStream());

    // The header that actually shipped — not the in-memory copy.
    const { header } = splitObject(bytes);
    expect(header.stored_bytes).toBe(bytes.length);
    expect(header.stored_bytes).toBe(object.size);
    expect(header.stored_bytes).toBeGreaterThan(0);
  });

  it("still declares a size that matches every stream it opens", async () => {
    const key = await deriveKey("phrase", TEST_KDF);
    const object = await build(key);
    const a = await collect(object.openStream());
    const b = await collect(object.openStream());
    expect(a.length).toBe(object.size);
    expect(b.length).toBe(object.size);
  });
});

describe("corrupt objects reject, never crash", () => {
  it("rejects a flipped ciphertext byte with an error, not an uncaught throw", async () => {
    const key = await deriveKey("phrase", TEST_KDF);
    const object = await build(key);
    const bytes = await collect(object.openStream());

    const tampered = Buffer.from(bytes);
    tampered[tampered.length - 20] ^= 0xff;

    await expect(decodeObject(tampered, key)).rejects.toThrow();
  });

  it("rejects the wrong key with an error", async () => {
    const key = await deriveKey("phrase", TEST_KDF);
    const wrong = await deriveKey("autre phrase", TEST_KDF);
    const bytes = await collect(await build(key).then((o) => o.openStream()));
    await expect(decodeObject(bytes, wrong)).rejects.toThrow();
  });
});

describe("decrypt transform is bounded", () => {
  it("refuses an implausible frame length instead of buffering forever", async () => {
    const nonceBase = newNonceBase();
    const key = Buffer.alloc(32, 7);
    const evil = Buffer.alloc(4);
    evil.writeUInt32BE(MAX_FRAME_BYTES + 1, 0);

    await expect(
      collect(Readable.from([evil]).pipe(new GcmDecryptTransform(key, nonceBase))),
    ).rejects.toThrow(/frame/i);
  });

  it("exposes a sane ceiling", () => {
    expect(MAX_FRAME_BYTES).toBeGreaterThan(1024 * 1024);
    expect(MAX_FRAME_BYTES).toBeLessThanOrEqual(64 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Converge `stored_bytes` before serialising**

In `object-codec.ts`, replace the header/size block in `encodeObject`. The old code serialised the header with `stored_bytes: 0` and then mutated the object, so the bytes on the wire never carried the real size:

```typescript
  // `stored_bytes` is inside the header it measures, so setting it changes
  // the header's own length. Iterate to a fixed point — it converges in at
  // most two rounds, because only the digit count can change.
  header.stored_bytes = 0;
  let headerBytes = encodeObjectHeader(header);
  let size = totalObjectSize(headerBytes.length, prepassResult.cipherBytes);
  for (let round = 0; round < 5 && header.stored_bytes !== size; round++) {
    header.stored_bytes = size;
    headerBytes = encodeObjectHeader(header);
    size = totalObjectSize(headerBytes.length, prepassResult.cipherBytes);
  }
  if (header.stored_bytes !== size) {
    throw new Error(`Object header size did not converge (${header.stored_bytes} vs ${size})`);
  }
```

- [ ] **Step 3: Compress once, not twice**

The prepass exists only to learn the exact `Content-Length`, and it throws away the compressed records it produced — so every byte is compressed twice at zstd level 15. Keep the records.

Change `PrepassResult` and `prepass`:

```typescript
interface PrepassResult {
  sha: string;
  bytes: number;
  cipherBytes: number;
  /** The compressed block records, in order, reused by the upload pass. */
  records: Buffer[];
}

async function prepass(source: Readable, algorithm: CompressionAlgorithm): Promise<PrepassResult> {
  const hasher = new Sha256Accumulator();
  let pending = Buffer.alloc(0);
  let cipherBytes = 0;
  const records: Buffer[] = [];

  const take = async (block: Buffer) => {
    const record = await compressBlock(block, algorithm);
    records.push(record);
    // frame = [u32 len][record][GCM tag]
    cipherBytes += 4 + record.length + 16;
  };

  for await (const chunk of source) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    hasher.update(buf);
    pending = Buffer.concat([pending, buf]);
    while (pending.length >= BLOCK_BYTES) {
      await take(pending.subarray(0, BLOCK_BYTES));
      pending = pending.subarray(BLOCK_BYTES);
    }
  }
  if (pending.length > 0) await take(pending);

  const { hex, bytes } = hasher.digest();
  return { sha: hex, bytes, cipherBytes, records };
}
```

Then `openStream` encrypts the already-compressed records instead of re-running the compressor:

```typescript
  const openStream = (): Readable => {
    const out = new PassThrough();
    const lenPrefix = Buffer.alloc(4);
    lenPrefix.writeUInt32BE(headerBytes.length, 0);
    out.write(lenPrefix);
    out.write(headerBytes);

    // The prepass already produced these records; compressing again would
    // double the CPU cost of every backup on a low-spec school PC. Each
    // record is pushed as its own chunk so it becomes exactly one GCM frame,
    // which is what `cipherBytes` was computed against.
    const encrypt = new GcmEncryptTransform(opts.key, nonceBase);
    encrypt.on("error", (err) => out.destroy(err));
    encrypt.pipe(out);
    for (const record of prepassResult.records) encrypt.write(record);
    encrypt.end();
    return out;
  };
```

Two consequences worth naming. First, the `plaintext` factory is now called exactly once (during the prepass), so it no longer needs to be re-invocable — leave the doc comment updated but the signature alone, since callers already pass a factory. Second, the records are held in memory: a 500 MB dump compresses to tens of megabytes of records, which is acceptable on the machines this targets, and it is the price of a truthful `Content-Length` without a second compression pass. If a school's dump ever outgrows that, the fix is a temp spill file, not a second compress.

- [ ] **Step 4: Propagate errors from every stage of the file decoder**

In `object-codec.ts`, `decodeObjectToFile` attaches `.on("error")` only to the write stream, so a GCM tag failure — the *expected* outcome for a corrupt backup — is an unhandled error event that takes down the process. Rewrite the pipeline with `pipeline()`:

```typescript
export async function decodeObjectToFile(
  objectStream: Readable,
  key: Buffer,
  header: ObjectHeader,
  targetPath: string,
): Promise<{ bytes: number }> {
  const { pipeline } = await import("node:stream/promises");
  const nonceBase = Buffer.from(header.cipher.nonce_base, "base64");
  const hasher = new Sha256Accumulator();

  const tee = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hasher.update(chunk);
      cb(null, chunk);
    },
  });

  try {
    // `pipeline` forwards an error from ANY stage and destroys the rest. The
    // old hand-wired version listened for errors on the write stream only, so
    // a bad GCM tag crashed the process instead of rejecting here.
    await pipeline(
      Readable.from(bodyAfterHeader(objectStream)),
      new GcmDecryptTransform(key, nonceBase),
      new DecompressTransform(header.compression),
      tee,
      createWriteStream(targetPath, { flags: "w" }),
    );
  } catch (err) {
    await rm(targetPath, { force: true });
    throw err;
  }

  const { hex, bytes } = hasher.digest();
  if (hex !== header.uncompressed_sha256) {
    await rm(targetPath, { force: true });
    throw new Error(
      `Checksum mismatch: snapshot claims SHA-256 ${header.uncompressed_sha256}, computed ${hex}. ` +
        "The stored object is corrupted or was tampered with; restore aborted.",
    );
  }
  if (bytes !== header.uncompressed_bytes) {
    await rm(targetPath, { force: true });
    throw new Error(`Size mismatch: snapshot claims ${header.uncompressed_bytes} bytes, got ${bytes}`);
  }
  return { bytes };
}
```

Add the imports this needs at the top of the file:

```typescript
import { Readable, PassThrough, Transform } from "node:stream";
import { rm } from "node:fs/promises";
```

Note the mismatch branches now delete the partial file, which the doc comment always claimed they did.

- [ ] **Step 5: Bound the decrypt transform**

In `cipher.ts`, export a ceiling and enforce it:

```typescript
/**
 * Largest frame the reader will accept.
 *
 * The length prefix comes from storage, i.e. from outside this process. A
 * corrupt or hostile u32 previously made the reader wait for up to 4 GiB that
 * would never arrive, growing its buffer without bound. Frames are one
 * compressed 1 MiB block plus overhead, so this is generous by an order of
 * magnitude.
 */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;
```

In `GcmDecryptTransform._transform`, immediately after reading `frameLen`:

```typescript
        const frameLen = this.buf.readUInt32BE(0);
        if (frameLen > MAX_FRAME_BYTES || frameLen < GCM_TAG_LENGTH) {
          throw new Error(
            `Implausible GCM frame length (${frameLen} bytes); the stored object is corrupt.`,
          );
        }
        if (this.buf.length < LEN_BYTES + frameLen) break;
```

- [ ] **Step 6: Typecheck and commit**

```bash
cd "D:/School Management System/apps/backend"
npx tsc --noEmit -p tsconfig.json
git add src/cloud-backup/crypto/ src/cloud-backup/__tests__/codec-integrity.spec.ts
git commit -m "fix: honest stored_bytes, single compression pass, bounded and error-safe decode"
```

---

## Phase 5 — Drivers and their callers

### Task 17: Fix the three drivers

**Closes:** F22 (gdrive's connection test validates a different folder than uploads use, creates a junk folder, and carries a dead no-op `files.update`), F23 (a new `S3Client` per call, never destroyed), F24 (`withRetry` burns four retries on permanently-failing errors), F35 (webdav's `caPath` option is a literal no-op).

**Files:**
- Create: `apps/backend/src/cloud-backup/drivers/retry-policy.ts`
- Create: `apps/backend/src/cloud-backup/__tests__/drivers.spec.ts`
- Modify: `apps/backend/src/cloud-backup/drivers/storage-driver.ts` (`withRetry`)
- Modify: `apps/backend/src/cloud-backup/drivers/s3.driver.ts`
- Modify: `apps/backend/src/cloud-backup/drivers/gdrive.driver.ts`
- Modify: `apps/backend/src/cloud-backup/drivers/webdav.driver.ts`

**Interfaces:**
- Produces: `isRetryable(err: unknown): boolean` — false for auth, not-found, and malformed-request failures; true for timeouts, resets, 5xx and rate limits.

- [ ] **Step 1: Author the guard**

Create `apps/backend/src/cloud-backup/__tests__/drivers.spec.ts`:

```typescript
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
  });

  it("exposes a destroy hook so sockets are released", () => {
    const driver = new S3Driver(config);
    expect(typeof (driver as unknown as { destroy?: () => void }).destroy).toBe("function");
  });
});

describe("gdrive driver source", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "drivers", "gdrive.driver.ts"),
    "utf8",
  ) as string;

  it("tests the connection against the real school folder, not a __probe__ one", () => {
    expect(source).not.toContain('rootFolder(auth, "__probe__")');
  });

  it("no longer carries the dead no-op files.update call", () => {
    expect(source).not.toContain("media: undefined as never");
  });
});

describe("webdav driver source", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "drivers", "webdav.driver.ts"),
    "utf8",
  ) as string;

  it("either implements caPath or does not advertise it", () => {
    const advertises = source.includes("caPath");
    const noOp = source.includes("{ httpAgent: undefined }");
    expect(advertises && noOp).toBe(false);
  });
});
```

- [ ] **Step 2: Write the retry policy**

Create `apps/backend/src/cloud-backup/drivers/retry-policy.ts`:

```typescript
/**
 * Which driver failures are worth trying again.
 *
 * `withRetry` used to retry everything, so a typo'd bucket name or a revoked
 * key spent four attempts and up to two and a half minutes of 30-second
 * timeouts before the setup wizard could say what was wrong. Permanent
 * failures should surface immediately and precisely; only transient ones earn
 * a backoff.
 *
 * Unrecognised errors are treated as transient. Retrying something permanent
 * costs time; giving up on something transient costs a backup.
 */
const PERMANENT_NAMES = new Set([
  "InvalidAccessKeyId",
  "SignatureDoesNotMatch",
  "NoSuchBucket",
  "AccessDenied",
  "AuthorizationHeaderMalformed",
  "InvalidBucketName",
  "PermanentRedirect",
]);

const PERMANENT_STATUS = new Set([400, 401, 403, 404, 405, 409, 501]);

export function isRetryable(err: unknown): boolean {
  const e = err as {
    name?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
    response?: { status?: number };
    status?: number;
  };

  if (e?.name && PERMANENT_NAMES.has(e.name)) return false;

  const status = e?.$metadata?.httpStatusCode ?? e?.response?.status ?? e?.status;
  if (typeof status === "number") {
    if (PERMANENT_STATUS.has(status)) return false;
    // 429 and 5xx are the classic retryable pair.
    return true;
  }

  const message = e?.message ?? String(err);
  if (/invalid_grant|invalid credentials|unauthorized|forbidden/i.test(message)) return false;
  return true;
}
```

- [ ] **Step 3: Teach `withRetry` to stop early**

In `storage-driver.ts`:

```typescript
import { isRetryable } from "./retry-policy";
```

```typescript
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: Partial<DriverOptions> = {},
): Promise<T> {
  const o = { ...DEFAULT_DRIVER_OPTIONS, ...opts };
  let attempt = 0;
  let backoff = o.backoffBaseMs;
  for (;;) {
    try {
      return await withTimeout(fn(), o.timeoutMs);
    } catch (err) {
      // A permanent failure will fail identically four more times; surfacing
      // it now is what lets the setup wizard say "bad key" instead of hanging.
      if (!isRetryable(err)) throw err;
      attempt++;
      if (attempt > o.maxRetries) throw err;
      await sleepWithJitter(backoff, o.backoffMaxMs);
      backoff = Math.min(backoff * 2, o.backoffMaxMs);
    }
  }
}
```

- [ ] **Step 4: Give the S3 driver one client**

In `s3.driver.ts`, memoise and add a teardown:

```typescript
  private cachedClient: S3Client | null = null;

  private client(): S3Client {
    // One client per driver instance. Constructing one per call leaked a
    // connection pool and its sockets on every drain cycle — about 1,400 a
    // day at the default interval.
    if (this.cachedClient) return this.cachedClient;
    this.cachedClient = new S3Client({
      endpoint: this.config.endpoint,
      region: this.config.region || "us-east-1",
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
        sessionToken: this.config.sessionToken,
      },
      forcePathStyle: this.config.addressing === "path",
      requestHandler: {
        connectionTimeout: this.options.timeoutMs,
        socketTimeout: this.options.timeoutMs,
      } as never,
    });
    return this.cachedClient;
  }

  /** Releases the underlying sockets. Safe to call more than once. */
  destroy(): void {
    this.cachedClient?.destroy();
    this.cachedClient = null;
  }
```

- [ ] **Step 5: Fix the Google Drive driver**

Three changes in `gdrive.driver.ts`.

Cache the resolved folder id so every call is not a `files.list`, and scope the lookup to the app's own folder:

```typescript
  private resolvedFolderId: string | null = null;

  private async rootFolder(auth: Auth.OAuth2Client, schoolId: string): Promise<string> {
    if (this.config.rootFolderId) return this.config.rootFolderId;
    if (this.resolvedFolderId) return this.resolvedFolderId;
    const drive = driveClient(auth);
    const folderName = `${BACKUP_FOLDER_PREFIX}${schoolId}`;
    const res = await drive.files.list({
      q: `name = '${folderName.replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: "files(id, name)",
      pageSize: 1,
    });
    this.resolvedFolderId =
      res.data.files?.[0]?.id ??
      (await drive.files.create({ requestBody: { name: folderName, mimeType: FOLDER_MIME }, fields: "id" })).data.id!;
    return this.resolvedFolderId;
  }
```

Make `testConnection` exercise the folder real uploads use. Add a `schoolId` to the config and use it:

```typescript
export interface GDriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** The school namespace, so the probe validates the folder uploads use. */
  schoolId?: string;
  rootFolderId?: string;
}
```

```typescript
  async testConnection(): Promise<{ ok: true; latencyMs: number; probe: string }> {
    const auth = this.auth();
    const probe = Buffer.from(`iq-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const key = `__iq_probe__/${probe.toString("base64url").slice(0, 40)}.bin`;
    const started = Date.now();
    try {
      await withRetry(async () => {
        const drive = driveClient(auth);
        // The probe must land in the same folder real uploads use; testing
        // against a "__probe__" folder let a broken config pass the test and
        // fail every actual backup, and littered the user's Drive.
        const folderId = await this.rootFolder(auth, this.config.schoolId ?? "default");
        const created = await drive.files.create({
          requestBody: { name: this.fileName(key), parents: [folderId] },
          media: { body: probe, mimeType: "application/octet-stream" },
          fields: "id",
        });
        const fileId = created.data.id!;
        const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
        const chunks: Buffer[] = [];
        for await (const chunk of res.data as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
        if (Buffer.compare(Buffer.concat(chunks), probe) !== 0) {
          throw new Error("Le contenu lu ne correspond pas au contenu écrit (round-trip mismatch).");
        }
        // Probe objects are the one thing worth removing: the namespace is
        // append-only for BACKUP data, not for connectivity litter.
        await drive.files.delete({ fileId }).catch(() => undefined);
      }, this.options);
      return { ok: true, latencyMs: Date.now() - started, probe: key };
    } catch (err) {
      throw this.classify(err);
    }
  }
```

Delete the dead block in `put` entirely — the `overwrite` handling from Task 10 step 3 replaces it:

```typescript
        // (removed) if (created.data.id && sizeHint) { drive.files.update({ media: undefined as never }) }
```

Finally, pass the school id when the driver is built. In `driver-registry.ts`, the `gdrive` definition's `create` already receives the stored config; add `schoolId` to the fields the setup form persists, or set it in `setup.service.ts` when the target is created. The simplest correct place is `createTarget` in `cloud-backup.controller.ts`, which already knows the configured school:

```typescript
    const state = await this.db.client.query.cloudState.findFirst({ where: eq(cloudState.singleton, "global") });
    const config = body.driverId === "gdrive" && state?.school_id
      ? { ...body.config, schoolId: state.school_id }
      : body.config;
```

and use `config` in place of `body.config` for both the `createDriver` call and the credential save.

- [ ] **Step 6: Honour or drop the WebDAV CA option**

In `webdav.driver.ts`, the current `...(this.config.caPath ? { httpAgent: undefined } : {})` does nothing at all while the type advertises the feature. Implement it:

```typescript
  private async client(): Promise<WebDAVClient> {
    if (!this.clientPromise) {
      this.clientPromise = loadWebdav().then(async ({ createClient }) => {
        const options: Record<string, unknown> = {
          username: this.config.username,
          password: this.config.password,
          authType: "password" as AuthType,
        };
        if (this.config.caPath) {
          // A corporate proxy or a self-hosted Nextcloud with a private CA.
          // The CA is ADDED to the trust store; verification is never
          // disabled, which is what the error copy already promises.
          const { readFileSync } = await import("node:fs");
          const { Agent } = await import("node:https");
          options.httpsAgent = new Agent({ ca: readFileSync(this.config.caPath) });
        }
        return createClient(trimTrailingSlash(this.config.baseUrl), options as never);
      });
    }
    return this.clientPromise;
  }
```

- [ ] **Step 7: Typecheck and commit**

```bash
cd "D:/School Management System/apps/backend"
npx tsc --noEmit -p tsconfig.json
git add src/cloud-backup/drivers/ src/cloud-backup/cloud-backup.controller.ts \
        src/cloud-backup/__tests__/drivers.spec.ts
git commit -m "fix: retry only transient driver errors, reuse the S3 client, repair gdrive and webdav"
```

---

### Task 18: Fix the two UI-facing defects

**Closes:** F20 (Google Drive restore strips the refresh token from the config it sends) and F21 ("Last sync" reports the oldest backup).

**Files:**
- Modify: `apps/frontend/components/auth/restore-flow.tsx:84-86` (`targetInput`)
- Modify: `apps/backend/src/cloud-backup/cloud-backup.controller.ts:126-134` (`lastSync`)
- Create: `apps/backend/src/cloud-backup/__tests__/last-sync.spec.ts`

- [ ] **Step 1: Author the guard**

Create `apps/backend/src/cloud-backup/__tests__/last-sync.spec.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONTROLLER = readFileSync(join(__dirname, "..", "cloud-backup.controller.ts"), "utf8");
const RESTORE_FLOW = readFileSync(
  join(__dirname, "..", "..", "..", "..", "frontend", "components", "auth", "restore-flow.tsx"),
  "utf8",
);

describe("status payload", () => {
  it("orders the manifest by newest first", () => {
    const lastSync = CONTROLLER.slice(CONTROLLER.indexOf("private async lastSync"));
    const body = lastSync.slice(0, lastSync.indexOf("\n  @"));
    // Ascending order returned the FIRST backup ever taken and called it
    // "last sync" forever.
    expect(body).toMatch(/desc\(/);
  });
});

describe("restore form", () => {
  it("does not strip oauth fields from the target config", () => {
    const target = RESTORE_FLOW.slice(RESTORE_FLOW.indexOf("const targetInput"));
    const body = target.slice(0, target.indexOf("const start"));
    // `.filter(f => f.type !== "oauth")` dropped the Google refresh token, so
    // a Drive restore could never authenticate.
    expect(body).not.toMatch(/f\.type\s*!==\s*"oauth"/);
  });
});
```

- [ ] **Step 2: Order the manifest descending**

In `cloud-backup.controller.ts`, add `desc` to the drizzle import and fix the query:

```typescript
import { desc, eq } from "drizzle-orm";
```

```typescript
  private async lastSync(): Promise<string | null> {
    const rows = await this.db.client
      .select({ at: backupManifest.created_at })
      .from(backupManifest)
      .orderBy(desc(backupManifest.created_at))
      .limit(1);
    return rows[0]?.at?.toISOString() ?? null;
  }
```

- [ ] **Step 3: Keep the OAuth field in the restore payload**

In `apps/frontend/components/auth/restore-flow.tsx`:

```tsx
  const targetInput = def
    ? {
        driverId: def.id,
        // Every field goes through, including the `oauth` refresh token —
        // filtering it out made a Google Drive restore impossible to
        // authenticate.
        config: Object.fromEntries(def.fields.map((f) => [f.name, values[f.name] ?? ""])),
      }
    : null;
```

The `canStart` guard above it already requires every `required` field to be non-empty, so the OAuth field is validated the same way the others are. Confirm the restore dialog actually renders an input for `type: "oauth"` fields; if it only renders a "Connect" button that depends on a logged-in session, render a plain text input in the restore context instead, with the help text `t("cloudSafeSave.restoreRefreshToken", "Collez le jeton d'actualisation Google noté lors de la configuration.")`.

- [ ] **Step 4: Typecheck and commit**

```bash
cd "D:/School Management System/apps/backend"
npx tsc --noEmit -p tsconfig.json
git add src/cloud-backup/cloud-backup.controller.ts src/cloud-backup/__tests__/last-sync.spec.ts \
        ../frontend/components/auth/restore-flow.tsx
git commit -m "fix: newest-first last sync, keep the oauth token in the restore config"
```

---

## Phase 6 — Hygiene and operability

### Task 19: Repair the three environment assumptions

**Closes:** F25 (the documented scrypt fallback is unreachable — a missing Argon2 binding kills module load), F26 (`schemaHash()` reads a path that does not exist in a production build, so migration detection never fires), F27 (the `DATABASE_URL` regex rejects `postgres://`, portless URLs, and passwords containing `@` or percent-encoding).

**Files:**
- Create: `apps/backend/src/common/pg-url.ts`
- Create: `apps/backend/src/common/__tests__/pg-url.spec.ts`
- Modify: `apps/backend/src/cloud-backup/crypto/kdf.ts:1-10, 95-108`
- Modify: `apps/backend/src/cloud-backup/worker/snapshot.service.ts` (`dbConfig`, `schemaHash`)
- Modify: `apps/backend/src/cloud-backup/restore/restore.service.ts` (`dbConfig`, `schemaHash`)

**Interfaces:**
- Produces: `parsePgUrl(url: string): { user, password, host, port, database }` — throws a French `Error` on anything it cannot parse.

- [ ] **Step 1: Author the guard**

Create `apps/backend/src/common/__tests__/pg-url.spec.ts`:

```typescript
import { parsePgUrl } from "../pg-url";

describe("DATABASE_URL parsing", () => {
  it("parses the standard form", () => {
    expect(parsePgUrl("postgresql://user:pass@localhost:5432/school")).toEqual({
      user: "user",
      password: "pass",
      host: "localhost",
      port: 5432,
      database: "school",
    });
  });

  it("accepts the postgres:// scheme", () => {
    expect(parsePgUrl("postgres://user:pass@localhost:5432/school").database).toBe("school");
  });

  it("defaults the port when it is omitted", () => {
    expect(parsePgUrl("postgresql://user:pass@localhost/school").port).toBe(5432);
  });

  it("decodes a percent-encoded password", () => {
    // The setup wizard generates random passwords; '@' and '/' are encoded.
    expect(parsePgUrl("postgresql://user:p%40ss%2Fword@localhost:5432/school").password).toBe("p@ss/word");
  });

  it("handles a password containing an at sign", () => {
    expect(parsePgUrl("postgresql://user:a%40b@localhost:5432/school")).toMatchObject({
      user: "user",
      password: "a@b",
      host: "localhost",
    });
  });

  it("strips query parameters from the database name", () => {
    expect(parsePgUrl("postgresql://u:p@localhost:5432/school?sslmode=require").database).toBe("school");
  });

  it("rejects something that is not a postgres URL", () => {
    expect(() => parsePgUrl("")).toThrow();
    expect(() => parsePgUrl("mysql://u:p@localhost/db")).toThrow();
  });
});
```

- [ ] **Step 2: Write the parser**

Create `apps/backend/src/common/pg-url.ts`:

```typescript
/**
 * Parses `DATABASE_URL` for the pg_dump / psql child processes.
 *
 * The previous regex — `^postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)` —
 * rejected the `postgres://` scheme, required an explicit port, broke on a
 * password containing '@', and never percent-decoded. The setup wizard
 * generates random passwords, so the encoding case is not hypothetical.
 * `new URL()` handles all of it.
 */
export interface PgConnection {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
}

export function parsePgUrl(raw: string): PgConnection {
  if (!raw) throw new Error("DATABASE_URL n'est pas défini.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL n'est pas une chaîne de connexion PostgreSQL valide");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL n'est pas une chaîne de connexion PostgreSQL valide");
  }
  const database = url.pathname.replace(/^\//, "").split("?")[0];
  if (!database) throw new Error("DATABASE_URL ne nomme aucune base de données.");
  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database,
  };
}
```

- [ ] **Step 3: Use it in both services**

In `snapshot.service.ts` and `restore.service.ts`, delete the private `dbConfig` methods entirely and import the shared one:

```typescript
import { parsePgUrl } from "../../common/pg-url";
```

Replace each `await this.dbConfig()` with:

```typescript
    const cfg = parsePgUrl(process.env.DATABASE_URL ?? "");
```

- [ ] **Step 4: Make the schema hash work in a production build**

`schemaHash()` reads `join(process.cwd(), "src", "db", "schema.ts")`, which does not exist when the app runs from `dist/`. Hash the compiled schema module instead, which exists in both layouts:

```typescript
  /**
   * Fingerprint of the schema, compared at boot to detect a migration.
   *
   * It used to read `src/db/schema.ts`, which is absent from a production
   * build — so it returned "" and migration detection never fired. Hashing
   * the table names and column names the running process actually has works
   * from `src` and `dist` alike, and is a truer signal anyway: it changes
   * when the schema changes, not when a comment does.
   */
  async schemaHash(): Promise<string> {
    const schema = await import("../../db/schema");
    const shape: string[] = [];
    for (const [name, table] of Object.entries(schema)) {
      const columns = (table as { [k: symbol]: unknown })?.constructor?.name === "PgTable" ? table : null;
      if (!columns) continue;
      const keys = Object.keys(table as Record<string, unknown>).sort();
      shape.push(`${name}:${keys.join(",")}`);
    }
    shape.sort();
    return createHash("sha256").update(shape.join("|")).digest("hex");
  }
```

Apply the identical method to `restore.service.ts`'s private `schemaHash`, or better, export this one from `snapshot.service.ts` and have restore call it — `RestoreService` does not currently inject `SnapshotService`, so the simplest change that avoids a duplicate is to move the function to `apps/backend/src/cloud-backup/worker/schema-hash.ts` as a free function and import it in both.

- [ ] **Step 5: Make the scrypt fallback reachable**

In `kdf.ts`, the static `import { hashRaw, Algorithm } from "@node-rs/argon2"` at line 1 throws at module load when the native binding is missing, so the documented fallback never runs and the whole app fails to boot. Load it lazily:

```typescript
import { scrypt as scryptCb, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const req = createRequire(__filename);

interface Argon2Binding {
  hashRaw(password: string, options: Record<string, unknown>): Promise<Buffer>;
  Algorithm: { Argon2id: number };
}

/**
 * Lazy Argon2 loader. A statically imported native module that fails to load
 * takes the entire process down at require time — which is exactly what the
 * scrypt fallback below exists to prevent, and exactly what the static import
 * made impossible.
 */
function tryLoadArgon2(): Argon2Binding | null {
  try {
    return req("@node-rs/argon2") as Argon2Binding;
  } catch {
    return null;
  }
}
```

Then in `deriveKey`:

```typescript
  if (params.alg === "argon2id") {
    const argon2 = tryLoadArgon2();
    if (!argon2) {
      throw new Error(
        "Cette sauvegarde utilise Argon2id mais la bibliothèque native est indisponible sur ce poste. " +
          "Réinstallez les dépendances (pnpm install) pour pouvoir la déchiffrer.",
      );
    }
    return argon2.hashRaw(phrase, {
      algorithm: argon2.Algorithm.Argon2id,
      salt,
      memoryCost: params.memoryCost ?? DEFAULT_KDF_PARAMS.memoryCost,
      timeCost: params.timeCost ?? DEFAULT_KDF_PARAMS.timeCost,
      parallelism: params.parallelism ?? 1,
      outputLen: params.keyLen,
    });
  }
```

and in `kdfAlgorithm()`:

```typescript
export function kdfAlgorithm(): KdfAlgorithm {
  if (preferredKdf) return preferredKdf;
  preferredKdf = tryLoadArgon2() ? "argon2id" : "scrypt";
  return preferredKdf;
}
```

The error message matters: a backup written with Argon2id is genuinely unreadable without the binding, so failing loudly at derive time is correct — what was wrong was failing at *import* time, on installs that would never have needed it.

- [ ] **Step 6: Typecheck and commit**

```bash
cd "D:/School Management System/apps/backend"
npx tsc --noEmit -p tsconfig.json
git add src/common/pg-url.ts src/common/__tests__/pg-url.spec.ts \
        src/cloud-backup/crypto/kdf.ts src/cloud-backup/worker/ src/cloud-backup/restore/
git commit -m "fix: robust DATABASE_URL parsing, working schema hash, reachable scrypt fallback"
```

---

### Task 20: Make the restore replay correct and survivable

**Closes:** F29 (one transaction per replayed event), F30 (`readHeader` can throw on a short first chunk and leaks a connection per call, and downloads whole objects to read 200 bytes), F38 (composite primary keys are half-handled and an all-PK payload builds invalid SQL).

**Files:**
- Modify: `apps/backend/src/cloud-backup/restore/restore.service.ts` (`readHeader`, `replayEvents`, `applyEvent`)
- Create: `apps/backend/src/cloud-backup/__tests__/replay.spec.ts`

- [ ] **Step 1: Author the guard**

Create `apps/backend/src/cloud-backup/__tests__/replay.spec.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RESTORE = readFileSync(join(__dirname, "..", "restore", "restore.service.ts"), "utf8");

describe("event replay", () => {
  it("batches events into one transaction, not one per row", () => {
    const replay = RESTORE.slice(RESTORE.indexOf("async replayEvents"));
    const body = replay.slice(0, replay.indexOf("\n  /** Step 4"));
    // withSyncDisabled opens a transaction; calling it per event meant one
    // transaction per row — 100k transactions for a modest school.
    const perEvent = /for \(const line of lines\)[\s\S]{0,400}withSyncDisabled/.test(body);
    expect(perEvent).toBe(false);
  });

  it("deletes using every primary key column, not just the first", () => {
    const apply = RESTORE.slice(RESTORE.indexOf("private async applyEvent"));
    const body = apply.slice(0, apply.indexOf("\n  private async pkColumns"));
    expect(body).not.toMatch(/pks\[0\]/);
  });

  it("handles a payload whose columns are all primary keys", () => {
    const apply = RESTORE.slice(RESTORE.indexOf("private async applyEvent"));
    const body = apply.slice(0, apply.indexOf("\n  private async pkColumns"));
    // An empty SET list produces `DO UPDATE SET ` — a syntax error.
    expect(body).toMatch(/DO NOTHING|setClause\.length|setColumns\.length/);
  });

  it("releases the stream after reading an object header", () => {
    const read = RESTORE.slice(RESTORE.indexOf("private async readHeader"));
    const body = read.slice(0, read.indexOf("\n  private async saltFromCloud"));
    expect(body).toMatch(/destroy\(\)/);
  });

  it("assembles the header length from all buffered bytes, not chunks[0]", () => {
    const read = RESTORE.slice(RESTORE.indexOf("private async readHeader"));
    const body = read.slice(0, read.indexOf("\n  private async saltFromCloud"));
    expect(body).not.toMatch(/chunks\[0\]\.readUInt32BE/);
  });
});
```

- [ ] **Step 2: Fix `readHeader`**

The current version reads the length from `chunks[0]`, which throws `RangeError` when the first chunk is under four bytes, and abandons the stream without destroying it — leaking one connection per event batch during discovery.

```typescript
  /** Reads just the plaintext header of an object, then releases the stream. */
  private async readHeader(driver: StorageDriver, key: string): Promise<ObjectHeader> {
    const stream = await driver.get(key);
    try {
      const chunks: Buffer[] = [];
      let total = 0;
      let needed = 4;
      for await (const chunk of stream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        chunks.push(buf);
        total += buf.length;
        if (total >= 4 && needed === 4) {
          // Concatenate before reading: the length can straddle two chunks,
          // and `chunks[0]` alone may be shorter than four bytes.
          needed = 4 + Buffer.concat(chunks).readUInt32BE(0);
          if (needed > 1_000_000) {
            throw new Error(`Object header length is implausible (${needed - 4} bytes); object is corrupt.`);
          }
        }
        if (total >= needed && needed > 4) break;
      }
      const { header } = splitObject(Buffer.concat(chunks));
      return header;
    } finally {
      // Abandoning a driver stream without destroying it holds an HTTP
      // connection open for the life of the process — one per batch.
      stream.destroy();
    }
  }
```

- [ ] **Step 3: Replay a whole batch in one transaction**

In `replayEvents`, hoist `withSyncDisabled` out of the per-line loop:

```typescript
    let applied = 0;
    for (const batch of batches) {
      const bytes = await this.readWhole(driver, batch.key);
      const decoded = await decodeObject(bytes, key);
      const lines = decoded.plaintext.toString("utf8").split("\n").filter(Boolean);

      // One transaction per BATCH, not per row. Per-row transactions meant a
      // hundred thousand commits for a modest school's history, and left the
      // batch half-applied if the process died mid-way.
      await withSyncDisabled(this.db, async (tx) => {
        for (const line of lines) {
          const event = JSON.parse(line) as {
            seq: number;
            entity_table: string;
            entity_id: string;
            operation: "insert" | "update" | "delete";
            payload: Record<string, unknown>;
          };
          if (event.seq <= job.applied_through_seq) continue;
          await this.applyEvent(tx, event);
          applied++;
        }
      });

      await this.db.client
        .update(restoreProgress)
        .set({ applied_through_seq: batch.to, state: "replaying" })
        .where(eq(restoreProgress.job_id, jobId));
    }
```

Because `applied_through_seq` advances only after the transaction commits, an interrupted restore now resumes at a batch boundary with no partially-applied batch behind it — which is what the resumability comment always claimed.

- [ ] **Step 4: Handle composite keys and all-PK payloads**

In `applyEvent`:

```typescript
    if (event.operation === "delete") {
      // Every PK column, not just the first — a composite key deleted far
      // more rows than it should have.
      const conditions = pks.map((pk) => {
        const value = toDbValue(event.payload[pk]);
        if (value == null) throw new Error(`Replay: missing primary key value ${pk} for ${table}`);
        return sql`${sql.raw(`"${pk}"`)} = ${param(value)}`;
      });
      await tx.execute(
        sql`DELETE FROM ${sql.raw(`public."${table}"`)} WHERE ${sql.join(conditions, sql.raw(" AND "))}`,
      );
      return;
    }

    const values = insertColumns.map((c) => toDbValue(event.payload[c]));
    const setColumns = insertColumns.filter((c) => !pks.includes(c));
    // A payload whose every column is part of the key has nothing to update;
    // an empty SET list produced `DO UPDATE SET ` — a syntax error.
    const conflictAction =
      setColumns.length === 0
        ? sql`DO NOTHING`
        : sql`DO UPDATE SET ${sql.raw(setColumns.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", "))}`;

    const stmt = sql`
      INSERT INTO ${sql.raw(`public."${table}"`)}
        (${sql.raw(insertColumns.map((c) => `"${c}"`).join(", "))})
      VALUES (${sql.join(values.map((v) => param(v)), sql.raw(", "))})
      ON CONFLICT (${sql.raw(pks.map((c) => `"${c}"`).join(", "))})
      ${conflictAction}
    `;
    await tx.execute(stmt);
```

- [ ] **Step 5: Order the primary key columns correctly**

`pkColumns` reads `pg_index` without ordering, so a composite key can come back in arbitrary order. It does not affect `ON CONFLICT` matching, but it does affect the delete clause and any future use. Add the ordering:

```typescript
    const result = (await tx.execute(
      sql`SELECT a.attname, k.ord
          FROM pg_index i
          JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
          WHERE i.indrelid = ${sql.raw(`'public.${table}'`)}::regclass AND i.indisprimary
          ORDER BY k.ord`,
    )) as unknown as { rows?: Array<{ attname: string }> };
```

- [ ] **Step 6: Typecheck and commit**

```bash
cd "D:/School Management System/apps/backend"
npx tsc --noEmit -p tsconfig.json
git add src/cloud-backup/restore/restore.service.ts src/cloud-backup/__tests__/replay.spec.ts
git commit -m "fix: batch replay transactions, composite keys, and header reads"
```

---

### Task 21: Operational loose ends

**Closes:** F28 (`sync_queue` grows without bound), F31 (`MachineBindingService` registered in two modules), F32 (the redaction regexes mangle ordinary log lines and errors never reach stderr), F34 (`backup/now` blocks the HTTP request through a full dump and upload), F39 (the audit daily-series loop mutates its cursor across DST).

**Files:**
- Modify: `apps/backend/src/cloud-backup/cloud-backup.module.ts` (drop the duplicate provider)
- Modify: `apps/backend/src/cloud-backup/redaction/redaction.ts`
- Modify: `apps/backend/src/cloud-backup/queue/sync-queue.service.ts` (add `pruneSent`)
- Modify: `apps/backend/src/cloud-backup/worker/sync-worker.service.ts` (call it; run `backupNow` detached)
- Modify: `apps/backend/src/cloud-backup/cloud-backup.controller.ts` (`backupNow` returns immediately)
- Modify: `apps/backend/src/audit/audit.service.ts` (`dailySeries` loop)
- Modify: `apps/backend/src/cloud-backup/__tests__/redaction.spec.ts` (extend)

- [ ] **Step 1: Author the guards**

Append to `apps/backend/src/cloud-backup/__tests__/redaction.spec.ts`:

```typescript
import { redactLog } from "../redaction/redaction";

describe("redaction does not mangle ordinary logs", () => {
  it("leaves a normal French sentence intact", () => {
    const line = "les triggers de capture sont prets sur les tables et le worker va demarrer sans erreur ici";
    expect(redactLog(line)).toBe(line);
  });

  it("leaves a sha-256 hex digest intact", () => {
    const line = "schema hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    expect(redactLog(line)).toBe(line);
  });

  it("still redacts a real secret assignment", () => {
    expect(redactLog('secretAccessKey: "abc123/def+ghi="')).toContain("[redacted]");
    expect(redactLog('password="hunter2"')).toContain("[redacted]");
  });

  it("still redacts a bearer token", () => {
    expect(redactLog("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig")).toContain("[redacted]");
  });

  it("still redacts a BIP39 recovery phrase", () => {
    const phrase = "abandon ability able about above absent absorb abstract absurd abuse access accident";
    expect(redactLog(`phrase=${phrase}`)).toContain("[redacted-recovery-phrase]");
  });
});
```

Create `apps/backend/src/cloud-backup/__tests__/operability.spec.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");

describe("module wiring", () => {
  it("does not register MachineBindingService twice", () => {
    const module = read("cloud-backup.module.ts");
    expect(module).not.toContain("MachineBindingService");
  });
});

describe("queue retention", () => {
  it("exposes a prune for rows that have been shipped", () => {
    expect(read("queue", "sync-queue.service.ts")).toContain("pruneSent");
  });
});

describe("manual backup", () => {
  it("does not hold the HTTP request open for the whole snapshot", () => {
    const controller = read("cloud-backup.controller.ts");
    const handler = controller.slice(controller.indexOf("async backupNow"));
    const body = handler.slice(0, handler.indexOf("\n  //"));
    expect(body).toMatch(/void |accepted|202/);
  });
});
```

- [ ] **Step 2: Drop the duplicate provider**

In `cloud-backup.module.ts`, remove the `MachineBindingService` import, its entry in `providers`, and the trailing `export { MachineBindingService };`. It is already provided by `AppModule`, and being in two modules means its `onApplicationBootstrap` — which shells out to `reg query` and can call `process.exit(1)` — runs twice.

- [ ] **Step 3: Narrow the redaction patterns**

In `redaction/redaction.ts`, replace the two over-broad patterns. The 40-character rule ate SHA-1 digests and any long identifier; the twelve-word rule ate ordinary prose.

```typescript
import { BIP39_WORDS } from "../crypto/bip39-words";

const BIP39_SET = new Set(BIP39_WORDS);

const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  {
    re: /(secret[_ ]?access[_ ]?key|client[_ ]?secret|refresh[_ ]?token|access[_ ]?token|password|passwd|authorization)\s*"?\s*[:=]\s*"?[^,}\s]+"?/gi,
    label: "$1=[redacted]",
  },
  { re: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, label: "$1 [redacted]" },
  { re: /\b(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16})\b/g, label: "[redacted-akid]" },
  // An AWS secret is 40 chars AND mixes classes AND is not pure hex — the old
  // rule was length alone, which redacted every SHA-1 and commit id in a log.
  { re: /\b(?![0-9a-f]{40}\b)(?=[A-Za-z0-9+/]{40}\b)(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z0-9+/]{40}\b/g, label: "[redacted-secret]" },
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, label: "[redacted-jwt]" },
];

/**
 * A run of twelve lowercase words is redacted only when EVERY word is in the
 * BIP39 list. Matching on shape alone redacted ordinary French log sentences,
 * which is how a safety feature became a legibility bug.
 */
function redactRecoveryPhrases(input: string): string {
  return input.replace(/\b(?:[a-z]{3,8}\s+){11}[a-z]{3,8}\b/g, (match) =>
    match.split(/\s+/).every((word) => BIP39_SET.has(word)) ? "[redacted-recovery-phrase]" : match,
  );
}

export function redactLog(input: string): string {
  if (!input) return input;
  let out = input;
  for (const { re, label } of SECRET_PATTERNS) out = out.replace(re, label);
  return redactRecoveryPhrases(out);
}
```

And send errors to stderr — the current ternary resolves to `console.log` for every level:

```typescript
    const sink = level === "error" || level === "fatal" ? console.error : level === "warn" ? console.warn : console.log;
    sink(`${color}[${this.context ?? "cloud-backup"}] ${redactLog(line)}${reset}`);
```

- [ ] **Step 4: Add queue retention**

In `sync-queue.service.ts`:

```typescript
/** Shipped rows are kept this long as a local audit trail, then pruned. */
export const SENT_RETENTION_DAYS = 30;
```

```typescript
  /**
   * Deletes rows that were shipped more than `days` ago.
   *
   * The cloud copy is append-only and authoritative; the local queue is a
   * shipping buffer. Keeping every row forever grew the table without bound
   * — years of a school's writes with their full JSON payloads — for no
   * recovery benefit, since a pruned row is already in an event batch.
   */
  async pruneSent(days: number = SENT_RETENTION_DAYS): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const rows = await this.db.client
      .delete(syncQueue)
      .where(and(eq(syncQueue.status, "sent"), lt(syncQueue.occurred_at, cutoff)))
      .returning({ id: syncQueue.id });
    return rows.length;
  }
```

Call it from the snapshot path in `sync-worker.service.ts`'s `snapshotNow`, after the snapshot succeeds — a row older than the newest snapshot is definitively covered:

```typescript
      const pruned = await this.queue.pruneSent();
      if (pruned > 0) this.logger.log(`Pruned ${pruned} shipped queue rows older than 30 days.`);
```

- [ ] **Step 5: Make the manual backup asynchronous**

In `cloud-backup.controller.ts`, `backupNow` currently awaits a full `pg_dump`, compression and upload inside the request — minutes, past any proxy timeout:

```typescript
  @Post("backup/now")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async backupNow() {
    const state = await this.db.client.query.cloudState.findFirst({ where: eq(cloudState.singleton, "global") });
    if (!state?.wrapped_key || !state.wrap_salt || !state.kdf_salt) {
      throw new BadRequestException("Sauvegarde cloud non configurée.");
    }
    const key = await this.keys.unwrap(state.wrapped_key, state.wrap_salt);
    const kdf = JSON.parse(state.kdf_salt) as KdfParams;
    const targets = await this.setup.enabledTargetDrivers();

    // Fire and report progress through /status. A full dump is minutes of
    // work; holding the request open guaranteed a proxy timeout and gave the
    // user no way to see how it went.
    void this.snapshots
      .runSnapshot(targets, key, state.school_id, kdf, "manual")
      .catch((err) => this.logger.error(`Manual snapshot failed: ${redactLogError(err)}`));

    return { accepted: true };
  }
```

Add the imports (`HttpCode`, `HttpStatus`, `KdfParams`) and a `private readonly logger = new RedactingLogger(CloudBackupController.name);` field. Update `apps/frontend/lib/api/cloud-backup.api.ts` and the Data safety section so the button reports "sauvegarde lancée" and relies on the existing 30-second status poll rather than awaiting a result.

- [ ] **Step 6: Fix the audit series loop**

In `apps/backend/src/audit/audit.service.ts`, `dailySeries` mutates its cursor with `setDate` while comparing against `end`, which double-counts or skips a day across a DST boundary. Iterate on an index instead:

```typescript
    const counts = new Map(rows.map((r) => [r.day, r.count]));
    const series: { day: string; count: number }[] = [];
    const pad = (n: number) => String(n).padStart(2, "0");
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    for (let i = 0; i <= days; i++) {
      // Rebuild from `start` each step: mutating one cursor with setDate
      // drifts across a DST change.
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      series.push({ day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, count: counts.get(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`) ?? 0 });
    }
    return series;
```

- [ ] **Step 7: Typecheck and commit**

```bash
cd "D:/School Management System/apps/backend"
npx tsc --noEmit -p tsconfig.json
git add src/cloud-backup/ src/audit/audit.service.ts ../frontend/lib/api/cloud-backup.api.ts \
        ../frontend/components/settings/data-safety-section.tsx
git commit -m "fix: queue retention, log redaction, async manual backup, module and series cleanups"
```

---

## Task 22: The verification gate

This is where everything written across Tasks 1–21 is actually run — once.

- [ ] **Step 1: Typecheck the whole backend**

```bash
cd "D:/School Management System/apps/backend"
npx tsc --noEmit -p tsconfig.json
```

Expected: exit 0. Any failure here is a signature mismatch between tasks — most likely the `put(..., opts?: PutOptions)` change from Task 10 not applied to all three drivers.

- [ ] **Step 2: Run the guard suite**

```bash
pnpm test:guards
```

Expected: every spec created by this plan passes. Roughly 60 assertions across 14 files, in seconds rather than minutes, because `jest.guards.config.js` transpiles instead of type-checking and touches only the guard directories.

- [ ] **Step 3: Run the full suite once**

```bash
pnpm test
```

This is the only full run in the whole plan. Its job is to prove that nothing in Tasks 1–21 broke the pre-existing scheduling, hierarchy or audit specs. Budget several minutes and expect to run it exactly once — if it fails, fix and re-run only the failing file with `npx jest <path>`.

- [ ] **Step 4: Build both apps**

```bash
cd "D:/School Management System"
pnpm build
```

Expected: exit 0. This catches anything the frontend edits in Tasks 14, 18 and 21 broke, which `tsc --noEmit` on the backend alone would miss.

- [ ] **Step 5: Commit the green state**

```bash
git add -A
git commit -m "chore: cloud backup remediation verified green"
```

---

## Coverage matrix

Every finding from the review, the task that closes it, and the guard that keeps it closed.

| # | Finding | Task | Guard |
|---|---|---|---|
| F1 | Restore rejects every valid recovery phrase | 2 | `check-object.spec.ts` — round-trips setup's bytes through restore's comparison |
| F2 | Targets 2..N and every retry get a consumed stream | 3 | `multi-target.spec.ts` — asserts identical decryptable bytes at three targets and across a retry |
| F3 | Setup verification can never report success | 4 | `setup-verify.spec.ts` — two healthy targets, empty queue, `ok: true` |
| F4 | DPAPI credentials are write-only on Windows | 5 | `credential-store.spec.ts` — save→load round trip incl. quotes and newlines |
| F5 | Migration 0007 is missing five columns | 6 | `migration-parity.spec.ts` — every `cloud_state` column in schema.ts appears in a migration |
| F6 | `.cloud-creds/` not git- or docker-ignored | 1 | `credential-store.spec.ts` — `git check-ignore` and `.dockerignore` assertions |
| F7 | Four restore endpoints unguarded and unthrottled | 7 | `restore-guard.spec.ts` — all five methods reject on a live install; burst is rejected |
| F8 | OAuth refresh token posted to `"*"` | 8 | `oauth-callback.spec.ts` — no wildcard `postMessage`; origin from the redirect URI |
| F9 | Failed queue rows stranded forever | 9 | `queue-retry.spec.ts` — `requeueRetryable` flips to pending; drain calls it before `nextBatch` |
| F10 | Split-brain guard never heartbeats, no CAS, ignored on restore | 10 | `registry-conflict.spec.ts` — conflict detection, stale-claim TTL, `finishRestore` checks it |
| F11 | `psql` restore deadlocks on unread stdout | 11 | `pg-subprocess.spec.ts` — stdout drained; the deadlock itself demonstrated |
| F12 | `pg_dump` resolves before the file flushes | 11 | `pg-subprocess.spec.ts` — asserts a `finish` listener |
| F13 | Actor interceptor registered nowhere; unsound design | 12 | `sync-context.spec.ts` — no dead class, transaction-local, no SQL interpolation |
| F14 | Cloud backup cannot start in Docker | 13 | `machine-key.spec.ts` — key always derivable, stable, persisted, install-unique |
| F15 | Re-running setup silently orphans all history | 14 | `setup-reinit.spec.ts` — rejects without confirmation, error names the consequence |
| F16 | `stored_bytes` is always 0 on the wire | 16 | `codec-integrity.spec.ts` — parses the shipped header, asserts real size |
| F17 | Every object compressed twice | 16 | Prepass records reused; covered by the size-equality assertions |
| F18 | Double `.end()` on the output stream | 3 | `multi-target.spec.ts` — repeated `openStream()` consumption |
| F19 | Corrupt object crashes instead of rejecting | 16 | `codec-integrity.spec.ts` — tampered byte and wrong key both reject |
| F20 | Google Drive restore strips the refresh token | 18 | `last-sync.spec.ts` — asserts the `oauth` filter is gone |
| F21 | "Last sync" shows the oldest backup | 18 | `last-sync.spec.ts` — asserts `desc(` ordering |
| F22 | gdrive probe folder, dead update, uncached folder id | 17 | `drivers.spec.ts` — source assertions on both defects |
| F23 | New `S3Client` per call, never destroyed | 17 | `drivers.spec.ts` — client identity and a `destroy` hook |
| F24 | `withRetry` retries permanent errors | 17 | `drivers.spec.ts` — one attempt for auth failure, four for a timeout |
| F25 | scrypt fallback unreachable | 19 | Lazy `tryLoadArgon2`; covered by existing `crypto.spec.ts` KDF tests |
| F26 | `schemaHash()` reads a path absent in production | 19 | Hashes the compiled schema module instead |
| F27 | `DATABASE_URL` regex too narrow | 19 | `pg-url.spec.ts` — scheme, port default, percent-decoding, `@` in password |
| F28 | `sync_queue` grows without bound | 21 | `operability.spec.ts` — `pruneSent` exists and is called after a snapshot |
| F29 | One transaction per replayed event | 20 | `replay.spec.ts` — asserts `withSyncDisabled` is not inside the line loop |
| F30 | `readHeader` chunk bug and connection leak | 20 | `replay.spec.ts` — no `chunks[0].readUInt32BE`, stream destroyed |
| F31 | `MachineBindingService` registered twice | 21 | `operability.spec.ts` — absent from the cloud-backup module |
| F32 | Redaction mangles logs; errors never reach stderr | 21 | `redaction.spec.ts` — prose and SHA-256 survive; real secrets still redacted |
| F33 | Unanchored CORS, no helmet, open Swagger | 8 | `cors-origin.spec.ts` — substring-containing origins rejected |
| F34 | `backup/now` blocks the request | 21 | `operability.spec.ts` — handler returns without awaiting the snapshot |
| F35 | WebDAV `caPath` is a no-op | 17 | `drivers.spec.ts` — advertised and no-op cannot both be true |
| F36 | WebDAV registry can never be rewritten | 10 | `registry-conflict.spec.ts` — two claims, two successful puts |
| F37 | GCM decrypt buffers without bound | 16 | `codec-integrity.spec.ts` — implausible frame length rejected |
| F38 | Composite PK / all-PK payload in replay | 20 | `replay.spec.ts` — no `pks[0]`, `DO NOTHING` branch present |
| F39 | Audit daily-series loop drifts across DST | 21 | Index-based iteration; covered by the existing audit specs |
| F40 | `drizzle-kit push --force` on every start | — | **Not fixed here.** Raised as a note in Task 6; needs its own plan. |

---

## Suggested order

Tasks 1 → 6 unblock the subsystem and can be parallelised across two people (1–3 are independent; 4–6 touch separate files). Task 15 should land before Task 16 so the runner exists. Everything from Task 16 on is independent and can be picked up in any order. Task 22 runs last, once.

If time is short, **Tasks 1–6 plus 22** produce a subsystem that works end to end; the rest is durability, security hardening and cleanup that can follow in a second pass.
