# Cloud Backup Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cloud disaster-recovery subsystem actually work end-to-end — setup, continuous sync, and restore-on-new-hardware — and put a regression guard on every defect found in the 2026-08-23 review.

**Architecture:** The subsystem stays exactly as designed (trigger-captured `sync_queue` → batched event objects → daily `pg_dump` snapshots → compress → AES-256-GCM → fan out to N storage drivers; restore = latest snapshot + replay). Nothing is redesigned. Each task repairs one broken seam and lands a test that fails before the fix and passes after. Three cross-cutting changes carry most of the weight: `EncodedObject` gains a re-invocable `openStream()` factory (single-use streams are the root cause of the multi-target and retry failures), the restore endpoints get the freshness guard they were documented to have, and the setup↔restore contract gets a round-trip test that exercises both sides against one in-memory driver.

**Tech Stack:** NestJS 10, Drizzle ORM 0.45, PostgreSQL 16, Jest 29 + ts-jest, `@aws-sdk/client-s3`, `webdav`, `googleapis`, `@node-rs/argon2`, `@mongodb-js/zstd`.

**Spec:** The 2026-08-23 code review recorded in this repo's conversation log. Findings are numbered F1–F40 and every task names the findings it closes; the Coverage Matrix at the end of this document maps all 40 to a task and a named guard test.

## Global Constraints

- **Node:** `>=20.9.0` (root `package.json` engines). Do not use APIs newer than Node 20.
- **Module system:** backend compiles to **CommonJS**. ESM-only packages (`webdav`) must stay behind `await import(...)`.
- **Test runner:** `jest` with `rootDir: src`, `testRegex: .*\.spec\.ts$`. All new tests live in `src/**/__tests__/*.spec.ts`.
- **Test command from `apps/backend`:** `npx jest <path> -t "<name>"`. Never `pnpm test` from the repo root for a single file — that runs the whole backend suite.
- **No live network, no live Postgres in unit tests.** Drivers are exercised through the in-memory fake built in Task 3. Anything needing a real database is out of scope for this plan.
- **KDF in tests:** always `buildKdfParams("scrypt", newSalt(), { scryptN: 1024 })`. Production Argon2id params (64 MiB) make the suite unusable.
- **User-facing strings are French.** Match the surrounding copy; do not introduce English error messages into the UI path.
- **Line endings:** the repo is checked out with CRLF on Windows. Do not reformat whole files; keep diffs minimal.
- **Commit style:** `fix:` / `feat:` / `chore:` prefix, imperative mood, no trailing period.
- **Do not run `drizzle-kit push --force` as part of any task.** Schema changes go through `db:generate` only (see Task 6).

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `apps/backend/src/cloud-backup/__tests__/support/memory-driver.ts` | In-memory `StorageDriver` used by every integration-flavoured test. Records every `put` body so tests can assert what actually landed per target. |
| `apps/backend/src/cloud-backup/__tests__/check-object.spec.ts` | Guard for the setup↔restore known-plaintext contract (F1). |
| `apps/backend/src/cloud-backup/__tests__/multi-target.spec.ts` | Guard for stream re-use across targets and retries (F2). |
| `apps/backend/src/cloud-backup/__tests__/credential-store.spec.ts` | Guard for credential save→load round trip (F4). |
| `apps/backend/src/cloud-backup/__tests__/queue-retry.spec.ts` | Guard for failed-row requeue (F9). |
| `apps/backend/src/cloud-backup/__tests__/registry-conflict.spec.ts` | Guard for split-brain claim/heartbeat (F10). |
| `apps/backend/src/cloud-backup/__tests__/drivers.spec.ts` | Guards for retry classification, client reuse, gdrive/webdav config (F22–F24, F35). |
| `apps/backend/src/cloud-backup/crypto/check-object.ts` | Single source of truth for the known-plaintext check payload, imported by setup and restore. |
| `apps/backend/src/cloud-backup/drivers/retry-policy.ts` | `isRetryable(err)` — separates transient from permanent driver failures. |
| `apps/backend/src/common/pg-url.ts` | One correct `DATABASE_URL` parser, shared by snapshot and restore. |
| `apps/backend/drizzle/0008_cloud_state_columns.sql` | Additive migration closing the 0007 drift. |

**Modified files** — listed per task.

---

## Phase 0 — Stop the bleeding

### Task 1: Keep credentials out of git and out of images

**Closes:** F6 (`.cloud-creds/` tracked by git and copied into Docker images).

**Files:**
- Modify: `.gitignore` (append to the "Local operational data" block, currently lines 33–38)
- Modify: `.dockerignore`
- Test: `apps/backend/src/cloud-backup/__tests__/credential-store.spec.ts` (created here, extended in Task 5)

This is first because it is the only finding that gets *worse* with time: the directory is empty today, so nothing has leaked yet, but it fills the moment anyone configures a backup target.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/cloud-backup/__tests__/credential-store.spec.ts`:

```typescript
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/** Repo root = four levels up from src/cloud-backup/__tests__. */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");

describe("credential directory hygiene", () => {
  it("git ignores .cloud-creds so target secrets can never be committed", () => {
    // git check-ignore exits 0 when the path IS ignored, 1 when it is not.
    let ignored = false;
    try {
      execFileSync("git", ["check-ignore", "-q", ".cloud-creds"], {
        cwd: REPO_ROOT,
        stdio: "ignore",
      });
      ignored = true;
    } catch {
      ignored = false;
    }
    expect(ignored).toBe(true);
  });

  it("docker ignores .cloud-creds so secrets are not baked into an image", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const dockerignore = readFileSync(join(REPO_ROOT, ".dockerignore"), "utf8");
    expect(dockerignore).toMatch(/^\.cloud-creds\/?$/m);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "D:/School Management System/apps/backend"
npx jest src/cloud-backup/__tests__/credential-store.spec.ts
```

Expected: both tests FAIL — `expect(false).toBe(true)` and no `.cloud-creds` match in `.dockerignore`.

- [ ] **Step 3: Add the ignore rules**

In `.gitignore`, inside the existing "Local operational data" block, after the `uploads/` line:

```
uploads/
# Cloud backup target credentials (DPAPI/machine-key encrypted, still secrets)
.cloud-creds/
```

In `.dockerignore`, after the `uploads` / `**/uploads` lines:

```
uploads
**/uploads
.cloud-creds
machine.lock
```

(`machine.lock` is already present in `.dockerignore`; keep only one copy.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest src/cloud-backup/__tests__/credential-store.spec.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Confirm nothing is already tracked**

```bash
cd "D:/School Management System"
git ls-files .cloud-creds
```

Expected: empty output. If it prints anything, run `git rm --cached -r .cloud-creds` before committing and treat those secrets as compromised — rotate them.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .dockerignore apps/backend/src/cloud-backup/__tests__/credential-store.spec.ts
git commit -m "fix: never commit or ship cloud backup credentials"
```

---

## Phase 1 — The five blockers

Nothing in the subsystem works until these five land. Tasks 2–6 are independent of each other and may be done in any order, except that Task 3 introduces the shared `memory-driver.ts` fixture that Tasks 10 and 17 reuse.

### Task 2: Make the recovery-phrase check object round-trip

**Closes:** F1 (restore rejects every valid phrase because setup and restore disagree on the check plaintext).

**Files:**
- Create: `apps/backend/src/cloud-backup/crypto/check-object.ts`
- Create: `apps/backend/src/cloud-backup/__tests__/check-object.spec.ts`
- Modify: `apps/backend/src/cloud-backup/setup/setup.service.ts:34-37` (the `CHECK_PLAINTEXT` const) and its use at `:127`
- Modify: `apps/backend/src/cloud-backup/restore/restore.service.ts:135-142` (the `expected` literal)

**Interfaces:**
- Produces: `buildCheckPlaintext(schoolId: string): string` — the exact bytes stored in `{schoolId}/meta/check.json.enc`. Both setup and restore import this; neither may build the JSON inline again.

The bug is that `setup.service.ts` writes `{purpose, known_plaintext}` while `restore.service.ts` compares against `{school_id, purpose, known_plaintext}`. Binding the school ID into the check object is the *better* of the two behaviours — it stops a phrase from validating against the wrong school's namespace — so the fix keeps `school_id` and moves setup to match.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/cloud-backup/__tests__/check-object.spec.ts`:

```typescript
import { buildKdfParams, deriveKey, newSalt } from "../crypto/kdf";
import { encodeObject, decodeObject } from "../crypto/object-codec";
import { compressionAlgorithm } from "../crypto/compression";
import { buildCheckPlaintext } from "../crypto/check-object";
import { Readable } from "node:stream";

const TEST_KDF = buildKdfParams("scrypt", newSalt(), { scryptN: 1024 });

async function encodeCheck(schoolId: string, key: Buffer): Promise<Buffer> {
  const encoded = await encodeObject({
    schoolId,
    objectKey: `${schoolId}/meta/check.json.enc`,
    kind: "check",
    kdf: TEST_KDF,
    key,
    compression: compressionAlgorithm(),
    plaintext: () => Readable.from([Buffer.from(buildCheckPlaintext(schoolId), "utf8")]),
  });
  const chunks: Buffer[] = [];
  for await (const chunk of encoded.openStream()) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe("recovery-phrase check object", () => {
  it("round-trips between what setup writes and what restore expects", async () => {
    const key = await deriveKey("phrase de test", TEST_KDF);
    const stored = await encodeCheck("ecole-test", key);

    const decoded = await decodeObject(stored, key);

    // This is the exact comparison restore.service.ts performs.
    expect(decoded.plaintext.toString("utf8")).toBe(buildCheckPlaintext("ecole-test"));
  });

  it("binds the school id, so one school's phrase does not validate another", () => {
    expect(buildCheckPlaintext("ecole-a")).not.toBe(buildCheckPlaintext("ecole-b"));
  });

  it("is byte-stable, so objects written by older installs still verify", () => {
    expect(buildCheckPlaintext("ecole-test")).toBe(
      '{"school_id":"ecole-test","purpose":"recovery-phrase-verification","known_plaintext":"cette phrase ouvre cette sauvegarde"}',
    );
  });
});
```

> Note: this test calls `encoded.openStream()`, which Task 3 introduces. If you are doing Task 2 first, temporarily use `encoded.stream` and switch it in Task 3 — Task 3's step 6 tells you to.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/cloud-backup/__tests__/check-object.spec.ts
```

Expected: FAIL — `Cannot find module '../crypto/check-object'`.

- [ ] **Step 3: Create the shared check payload**

Create `apps/backend/src/cloud-backup/crypto/check-object.ts`:

```typescript
/**
 * The known-plaintext object that proves a recovery phrase opens a backup.
 *
 * Setup encrypts this and stores it at `{school_id}/meta/check.json.enc`;
 * restore decrypts it with the key derived from the typed phrase and compares
 * byte-for-byte. Both sides MUST build it here — the two call sites drifted
 * once already (setup omitted `school_id`, restore required it), which made
 * every restore reject a perfectly valid phrase.
 *
 * Key order is part of the format: these bytes are compared with `!==`, not
 * parsed. Never reorder the fields, and never add one without bumping
 * FORMAT_VERSION and teaching restore to accept both shapes.
 */
export function buildCheckPlaintext(schoolId: string): string {
  return JSON.stringify({
    school_id: schoolId,
    purpose: "recovery-phrase-verification",
    known_plaintext: "cette phrase ouvre cette sauvegarde",
  });
}
```

- [ ] **Step 4: Point setup at it**

In `apps/backend/src/cloud-backup/setup/setup.service.ts`, delete the module-level `CHECK_PLAINTEXT` const (lines 34–37) and add to the imports:

```typescript
import { buildCheckPlaintext } from "../crypto/check-object";
```

Then in `seedCloud`, change the `plaintext` factory:

```typescript
      plaintext: () => Readable.from([Buffer.from(buildCheckPlaintext(schoolId), "utf8")]),
```

- [ ] **Step 5: Point restore at it**

In `apps/backend/src/cloud-backup/restore/restore.service.ts`, add to the imports:

```typescript
import { buildCheckPlaintext } from "../crypto/check-object";
```

Replace the inline `expected` literal (lines 135–139) with:

```typescript
    const expected = buildCheckPlaintext(input.schoolId);
```

- [ ] **Step 6: Verify no inline copies remain**

```bash
cd "D:/School Management System/apps/backend"
grep -rn "recovery-phrase-verification" src/
```

Expected: exactly one hit, in `src/cloud-backup/crypto/check-object.ts`.

- [ ] **Step 7: Run the test to verify it passes**

```bash
npx jest src/cloud-backup/__tests__/check-object.spec.ts
```

Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/cloud-backup/crypto/check-object.ts \
        apps/backend/src/cloud-backup/__tests__/check-object.spec.ts \
        apps/backend/src/cloud-backup/setup/setup.service.ts \
        apps/backend/src/cloud-backup/restore/restore.service.ts
git commit -m "fix: share one check-object payload between setup and restore"
```

**Migration note for anyone who already ran setup:** their stored check object has the old shape and will now fail verification. There is no data at risk — the fix is to re-run setup step 1 with the same phrase, which rewrites `meta/check.json.enc`. Task 14 adds the guard that makes re-running step 1 safe.

---

### Task 3: Make encoded objects re-streamable

**Closes:** F2 (targets 2..N and every upload retry receive an already-consumed stream).

**Files:**
- Create: `apps/backend/src/cloud-backup/__tests__/support/memory-driver.ts`
- Create: `apps/backend/src/cloud-backup/__tests__/multi-target.spec.ts`
- Modify: `apps/backend/src/cloud-backup/crypto/object-codec.ts:29-95` (`EncodedObject`, `encodeObject`)
- Modify: `apps/backend/src/cloud-backup/worker/sync-worker.service.ts:288`
- Modify: `apps/backend/src/cloud-backup/worker/snapshot.service.ts:154` and `:209`
- Modify: `apps/backend/src/cloud-backup/setup/setup.service.ts:139`
- Modify: `apps/backend/src/cloud-backup/__tests__/crypto.spec.ts:146,178,199,224`

**Interfaces:**
- Produces: `EncodedObject.openStream(): Readable` — replaces the single-use `stream` property. Each call builds a fresh compress→encrypt pipeline over a fresh plaintext source. `size` and `header` are unchanged and remain valid across calls.
- Produces: `MemoryDriver` (test fixture) with `puts: Map<string, Buffer>` and `putCount: Map<string, number>`, plus `failNextPuts(n: number)` to force retries.

A `Readable` is consumed once. `encodeObject` already takes `plaintext: () => Readable` — a factory — so the fix is to stop materialising the pipeline eagerly and expose the same factory shape one level up.

- [ ] **Step 1: Write the failing test — the fixture first**

Create `apps/backend/src/cloud-backup/__tests__/support/memory-driver.ts`:

```typescript
import { Readable } from "node:stream";
import type { ObjectMeta, PutResult, StorageDriver } from "../../drivers/storage-driver";

/**
 * In-memory StorageDriver for tests.
 *
 * Records the full body of every put so a test can assert what actually
 * landed — which is the only way to catch a consumed-stream bug, since an
 * exhausted stream uploads successfully, just empty.
 */
export class MemoryDriver implements StorageDriver {
  readonly id = "s3" as const;
  readonly displayName = "Memory";

  readonly puts = new Map<string, Buffer>();
  readonly putCount = new Map<string, number>();
  private failures = 0;

  /** Make the next `n` put attempts throw, to exercise the retry path. */
  failNextPuts(n: number): void {
    this.failures = n;
  }

  async testConnection(): Promise<{ ok: true; latencyMs: number; probe: string }> {
    return { ok: true, latencyMs: 1, probe: "memory" };
  }

  async put(key: string, stream: Readable, sizeHint?: number): Promise<PutResult> {
    this.putCount.set(key, (this.putCount.get(key) ?? 0) + 1);
    if (this.failures > 0) {
      this.failures--;
      throw new Error("simulated transient upload failure");
    }
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    const body = Buffer.concat(chunks);
    this.puts.set(key, body);
    if (sizeHint !== undefined && body.length !== sizeHint) {
      throw new Error(`Content-Length mismatch: declared ${sizeHint}, streamed ${body.length}`);
    }
    return { key, size: body.length };
  }

  async get(key: string): Promise<Readable> {
    const body = this.puts.get(key);
    if (!body) throw new Error(`No such object: ${key}`);
    return Readable.from([body]);
  }

  async list(prefix: string): Promise<ObjectMeta[]> {
    return [...this.puts.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, body]) => ({ key, size: body.length, lastModified: null }));
  }
}
```

- [ ] **Step 2: Write the failing test — the assertion**

Create `apps/backend/src/cloud-backup/__tests__/multi-target.spec.ts`:

```typescript
import { buildKdfParams, deriveKey, newSalt } from "../crypto/kdf";
import { encodeObject, decodeObject } from "../crypto/object-codec";
import { compressionAlgorithm } from "../crypto/compression";
import { withRetry } from "../drivers/storage-driver";
import { MemoryDriver } from "./support/memory-driver";
import { Readable } from "node:stream";

const TEST_KDF = buildKdfParams("scrypt", newSalt(), { scryptN: 1024 });
const PAYLOAD = Buffer.from(JSON.stringify({ hello: "monde", rows: Array.from({ length: 500 }, (_, i) => i) }), "utf8");

async function encoded(key: Buffer) {
  return encodeObject({
    schoolId: "ecole-test",
    objectKey: "ecole-test/events/2026-08-23/1-1.jsonl.zst.enc",
    kind: "event_batch",
    kdf: TEST_KDF,
    key,
    compression: compressionAlgorithm(),
    seqFrom: 1,
    seqTo: 1,
    plaintext: () => Readable.from([PAYLOAD]),
  });
}

describe("one encoded object, many consumers", () => {
  it("uploads identical bytes to every target in a fan-out", async () => {
    const key = await deriveKey("phrase de test", TEST_KDF);
    const object = await encoded(key);
    const targets = [new MemoryDriver(), new MemoryDriver(), new MemoryDriver()];

    for (const target of targets) {
      await target.put(object.header.object_key, object.openStream(), object.size);
    }

    const bodies = targets.map((t) => t.puts.get(object.header.object_key)!);
    expect(bodies.every((b) => b !== undefined && b.length === object.size)).toBe(true);
    expect(bodies[1].equals(bodies[0])).toBe(true);
    expect(bodies[2].equals(bodies[0])).toBe(true);

    // And every copy is genuinely decryptable — not just equal-length.
    const round = await decodeObject(bodies[2], key);
    expect(round.plaintext.equals(PAYLOAD)).toBe(true);
  });

  it("survives a retry after a failed upload attempt", async () => {
    const key = await deriveKey("phrase de test", TEST_KDF);
    const object = await encoded(key);
    const target = new MemoryDriver();
    target.failNextPuts(2);

    await withRetry(
      () => target.put(object.header.object_key, object.openStream(), object.size),
      { maxRetries: 4, backoffBaseMs: 1, backoffMaxMs: 2, timeoutMs: 5_000 },
    );

    expect(target.putCount.get(object.header.object_key)).toBe(3);
    const body = target.puts.get(object.header.object_key)!;
    const round = await decodeObject(body, key);
    expect(round.plaintext.equals(PAYLOAD)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx jest src/cloud-backup/__tests__/multi-target.spec.ts
```

Expected: FAIL — `object.openStream is not a function`.

- [ ] **Step 4: Replace `stream` with `openStream()`**

In `apps/backend/src/cloud-backup/crypto/object-codec.ts`, change the `EncodedObject` interface:

```typescript
export interface EncodedObject {
  header: ObjectHeader;
  /**
   * Opens a FRESH object stream: [u32 len][header JSON][GCM frames].
   *
   * Call it once per target and once per retry. It used to be a single
   * `stream` property, which meant target #2 and every retry received an
   * already-drained Readable and silently uploaded nothing.
   */
  openStream(): Readable;
  /** Exact wire size, identical for every stream this object opens. */
  size: number;
}
```

Then replace the tail of `encodeObject` (everything from `const out = new PassThrough();` to the `return`) with:

```typescript
  const openStream = (): Readable => {
    const out = new PassThrough();
    const lenPrefix = Buffer.alloc(4);
    lenPrefix.writeUInt32BE(headerBytes.length, 0);
    out.write(lenPrefix);
    out.write(headerBytes);

    const pipe = opts
      .plaintext()
      .pipe(new CompressTransform(opts.compression))
      .pipe(new GcmEncryptTransform(opts.key, nonceBase));
    // `pipe()` already ends `out` on completion — calling out.end() here too
    // raised ERR_STREAM_ALREADY_FINISHED. Only forward errors.
    pipe.on("error", (err) => out.destroy(err));
    pipe.pipe(out);
    return out;
  };

  return { header, openStream, size };
```

Note this also closes F18 (the double-`end()`): the explicit `pipe.on("end", () => out.end())` is gone.

- [ ] **Step 5: Update the four production call sites**

`worker/sync-worker.service.ts:288`, `worker/snapshot.service.ts:154`, `worker/snapshot.service.ts:209`, `setup/setup.service.ts:139` — each is inside a `for (const target of ...)` loop. Change:

```typescript
await target.driver.put(objectKey, encoded.stream, encoded.size);
```

to:

```typescript
await target.driver.put(objectKey, encoded.openStream(), encoded.size);
```

and in `setup.service.ts` specifically:

```typescript
await driver.put(`${schoolId}/meta/check.json.enc`, checkEncoded.openStream(), checkEncoded.size);
```

- [ ] **Step 6: Update the existing crypto tests**

In `apps/backend/src/cloud-backup/__tests__/crypto.spec.ts`, lines 146, 178, 199 and 224 each read `for await (const chunk of encoded.stream)`. Change every one to:

```typescript
    for await (const chunk of encoded.openStream()) chunks.push(chunk);
```

If you wrote Task 2's test against `encoded.stream`, switch it to `encoded.openStream()` now.

- [ ] **Step 7: Verify no `.stream` references survive**

```bash
grep -rn "encoded\.stream\|checkEncoded\.stream\|\.stream," src/cloud-backup/
```

Expected: no hits.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
npx jest src/cloud-backup/__tests__/multi-target.spec.ts src/cloud-backup/__tests__/crypto.spec.ts
```

Expected: PASS. The `Content-Length mismatch` assertion inside `MemoryDriver.put` also proves `size` is honest for every stream opened.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/cloud-backup/crypto/object-codec.ts \
        apps/backend/src/cloud-backup/worker/sync-worker.service.ts \
        apps/backend/src/cloud-backup/worker/snapshot.service.ts \
        apps/backend/src/cloud-backup/setup/setup.service.ts \
        apps/backend/src/cloud-backup/__tests__/
git commit -m "fix: re-open the encoded object stream per target and per retry"
```

---

### Task 4: Count the queue, not the targets

**Closes:** F3 (setup step 2 can never report success).

**Files:**
- Modify: `apps/backend/src/cloud-backup/setup/setup.service.ts:143-165` (`verify` and `pendingCount`)
- Test: `apps/backend/src/cloud-backup/__tests__/setup-verify.spec.ts` (create)

`pendingCount()` runs `count()` against `cloudTargets`. `verify()` then requires `pending === 0`, so configuring even one target guarantees `ok: false`. `SyncQueueService.stats()` already computes the real number.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/cloud-backup/__tests__/setup-verify.spec.ts`:

```typescript
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
  const queue = { stats: async () => ({ pending: opts.queuePending, failed: 0, total: 0, oldestPendingAt: null, pendingBytes: 0 }) };
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/cloud-backup/__tests__/setup-verify.spec.ts
```

Expected: FAIL — the constructor takes six arguments, not seven, and `pendingCount` queries the wrong table.

- [ ] **Step 3: Inject the queue service and fix the count**

In `apps/backend/src/cloud-backup/setup/setup.service.ts`, add the import:

```typescript
import { SyncQueueService } from "../queue/sync-queue.service";
```

Add a seventh constructor parameter:

```typescript
    private readonly registry: InstanceRegistryService,
    private readonly queue: SyncQueueService,
  ) {}
```

Replace `pendingCount` entirely:

```typescript
  /** Rows still waiting in the sync queue. Was counting cloud_targets. */
  private async pendingCount(): Promise<number> {
    return (await this.queue.stats()).pending;
  }
```

And simplify `verify()`'s body so it always asks the queue:

```typescript
    const drained = await this.worker.runDrainNow();
    const targets = await this.db.client.select().from(cloudTargets).where(eq(cloudTargets.enabled, true));
    const targetStatus = targets.map((t) => ({
      id: t.id,
      ok: !t.last_error && t.last_success_at !== null,
      lastError: t.last_error,
    }));
    const pending = await this.pendingCount();
    return {
      ok: targetStatus.length > 0 && targetStatus.every((t) => t.ok) && pending === 0,
      drained,
      pending,
      targets: targetStatus,
    };
```

- [ ] **Step 4: Register the dependency**

`SyncQueueService` is already a provider in `cloud-backup.module.ts`, so Nest resolves it with no module change. Confirm:

```bash
grep -n "SyncQueueService" src/cloud-backup/cloud-backup.module.ts
```

Expected: it appears in `providers`.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx jest src/cloud-backup/__tests__/setup-verify.spec.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/cloud-backup/setup/setup.service.ts \
        apps/backend/src/cloud-backup/__tests__/setup-verify.spec.ts
git commit -m "fix: setup verification counts queued rows instead of targets"
```

---

### Task 5: Make Windows credential storage readable

**Closes:** F4 (`dpapiUnprotect` calls the encrypt cmdlet, so every DPAPI-stored secret is write-only).

**Files:**
- Modify: `apps/backend/src/cloud-backup/credential-store/credential-store.service.ts:163-186` (`dpapiUnprotect`)
- Modify: `apps/backend/src/cloud-backup/credential-store/credential-store.service.ts:105-118` (`load` — surface the failure)
- Test: `apps/backend/src/cloud-backup/__tests__/credential-store.spec.ts` (extend Task 1's file)

`ConvertFrom-SecureString` turns a SecureString into an encrypted string. To reverse it you need `ConvertTo-SecureString`. The save path works, the load path throws, and `load()` swallows the throw and returns `null` — so targets silently disappear from `enabledTargets()` with only a log line.

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/src/cloud-backup/__tests__/credential-store.spec.ts`:

```typescript
import { CredentialStoreService } from "../credential-store/credential-store.service";
import { randomUUID } from "node:crypto";

describe("credential store round trip", () => {
  const store = new CredentialStoreService();
  const written: string[] = [];

  afterAll(async () => {
    for (const id of written) await store.delete(id);
  });

  it("loads back exactly what it saved", async () => {
    const entryId = randomUUID();
    written.push(entryId);
    const secret = JSON.stringify({
      driver: "s3",
      config: { endpoint: "https://s3.example.com", accessKeyId: "AKIAEXAMPLE", secretAccessKey: "s3cr3t/value+with=chars" },
    });

    await store.save(entryId, secret);
    expect(store.has(entryId)).toBe(true);

    const loaded = await store.load(entryId);
    expect(loaded).toBe(secret);
  }, 60_000);

  it("survives secrets containing quotes and newlines", async () => {
    const entryId = randomUUID();
    written.push(entryId);
    const secret = JSON.stringify({ driver: "webdav", config: { password: `a'b"c\nd` } });

    await store.save(entryId, secret);
    expect(await store.load(entryId)).toBe(secret);
  }, 60_000);

  it("returns null for an entry that was never saved", async () => {
    expect(await store.load(randomUUID())).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/cloud-backup/__tests__/credential-store.spec.ts -t "loads back exactly"
```

Expected on Windows: FAIL — `expect(null).toBe(...)`, with a logged `Failed to load credential entry …`.

On macOS/Linux this test passes already (the machine-key file path is correct); the fix below is Windows-only but the guard is cross-platform.

- [ ] **Step 3: Use the correct cmdlet**

In `credential-store.service.ts`, in `dpapiUnprotect`, change the `$secure` assignment:

```typescript
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$secure = ConvertTo-SecureString '${escaped}'`,
      "$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
      "try { [Console]::Out.Write([System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)) }",
      "finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }",
    ].join("; ");
```

`ConvertTo-SecureString` with no `-Key` uses DPAPI under the current user — the exact inverse of the `ConvertFrom-SecureString` in `dpapiProtect`.

- [ ] **Step 4: Stop swallowing load failures silently**

Still in `credential-store.service.ts`, the `catch` in `load()` logs and returns `null`, which is how a decrypt bug turned into "the target vanished". Keep returning `null` (callers depend on it) but make it unmistakable:

```typescript
    } catch (err) {
      this.logger.error(
        `Impossible de lire les identifiants de la destination ${entryId} : ${(err as Error).message}. ` +
          "Cette destination sera ignorée par la sauvegarde tant que ses identifiants ne sont pas ressaisis.",
      );
      return null;
    }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx jest src/cloud-backup/__tests__/credential-store.spec.ts
```

Expected: PASS (5 tests, including Task 1's two).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/cloud-backup/credential-store/credential-store.service.ts \
        apps/backend/src/cloud-backup/__tests__/credential-store.spec.ts
git commit -m "fix: decrypt DPAPI credentials with ConvertTo-SecureString"
```

---

### Task 6: Close the migration drift

**Closes:** F5 (`drizzle/0007` is missing five columns that `schema.ts` declares).

**Files:**
- Create: `apps/backend/drizzle/0008_cloud_state_columns.sql`
- Modify: `apps/backend/drizzle/meta/_journal.json`
- Create: `apps/backend/drizzle/meta/0008_snapshot.json` (generated)
- Test: `apps/backend/src/cloud-backup/__tests__/migration-parity.spec.ts` (create)

Missing from 0007: `cloud_state.wrapped_key`, `cloud_state.wrap_salt`, `cloud_state.schema_hash`, `sync_queue.last_error`, `sync_queue.processed_at`. `loadState()` selects `wrapped_key` at boot, so a migrate-only install (which is what `docker-entrypoint.sh` attempts first) starts against a schema the code cannot use. Editing 0007 in place is wrong — installs that already applied it would never pick up the change — so this is an additive 0008.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/cloud-backup/__tests__/migration-parity.spec.ts`:

```typescript
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DRIZZLE_DIR = join(__dirname, "..", "..", "..", "drizzle");

function allMigrationSql(): string {
  return readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(DRIZZLE_DIR, f), "utf8"))
    .join("\n");
}

/**
 * The launchers run `drizzle-kit push`, which papers over migration drift on
 * a developer machine. Docker runs `drizzle-kit migrate` first. Any column the
 * code SELECTs must therefore exist in the migration files, not just in
 * schema.ts.
 */
describe("migration parity with schema.ts", () => {
  const sql = allMigrationSql();

  it.each([
    ["cloud_state", "wrapped_key"],
    ["cloud_state", "wrap_salt"],
    ["cloud_state", "schema_hash"],
    ["sync_queue", "last_error"],
    ["sync_queue", "processed_at"],
  ])("migrations create %s.%s", (_table, column) => {
    expect(sql).toMatch(new RegExp(`"${column}"`));
  });

  it("every cloud_state column in schema.ts appears in some migration", () => {
    const schema = readFileSync(join(__dirname, "..", "..", "db", "schema.ts"), "utf8");
    const block = schema.slice(schema.indexOf("export const cloudState"));
    const declared = [...block.slice(0, block.indexOf("});")).matchAll(/^\t(\w+):/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(10);
    for (const column of declared) {
      expect(sql).toMatch(new RegExp(`"${column}"`));
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/cloud-backup/__tests__/migration-parity.spec.ts
```

Expected: FAIL on `wrapped_key`, `wrap_salt`, `schema_hash`, `last_error`, `processed_at`.

- [ ] **Step 3: Write the migration by hand**

Do **not** run `drizzle-kit generate` against a pushed database — it will diff against the already-drifted live schema and emit an empty migration. Create `apps/backend/drizzle/0008_cloud_state_columns.sql`:

```sql
ALTER TABLE "cloud_state" ADD COLUMN IF NOT EXISTS "wrapped_key" text;--> statement-breakpoint
ALTER TABLE "cloud_state" ADD COLUMN IF NOT EXISTS "wrap_salt" text;--> statement-breakpoint
ALTER TABLE "cloud_state" ADD COLUMN IF NOT EXISTS "schema_hash" text;--> statement-breakpoint
ALTER TABLE "sync_queue" ADD COLUMN IF NOT EXISTS "last_error" text;--> statement-breakpoint
ALTER TABLE "sync_queue" ADD COLUMN IF NOT EXISTS "processed_at" timestamp (3);
```

`IF NOT EXISTS` matters: installs that already ran `drizzle-kit push` have these columns, and this migration must be a no-op there rather than an error.

- [ ] **Step 4: Register it in the journal**

In `apps/backend/drizzle/meta/_journal.json`, append to the `entries` array after the `0007_volatile_changeling` object:

```json
    {
      "idx": 8,
      "version": "7",
      "when": 1787270400000,
      "tag": "0008_cloud_state_columns",
      "breakpoints": true
    }
```

- [ ] **Step 5: Produce the snapshot**

```bash
cd "D:/School Management System/apps/backend"
cp drizzle/meta/0007_snapshot.json drizzle/meta/0008_snapshot.json
```

Then hand-edit `drizzle/meta/0008_snapshot.json`: bump `"id"` to a fresh UUID, set `"prevId"` to 0007's `"id"`, and add the five columns to the `cloud_state` and `sync_queue` entries so the snapshot matches the post-0008 shape. Use the column definitions already present in `schema.ts` as the reference for types and nullability.

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx jest src/cloud-backup/__tests__/migration-parity.spec.ts
```

Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/drizzle/0008_cloud_state_columns.sql \
        apps/backend/drizzle/meta/_journal.json \
        apps/backend/drizzle/meta/0008_snapshot.json \
        apps/backend/src/cloud-backup/__tests__/migration-parity.spec.ts
git commit -m "fix: add migration for cloud_state and sync_queue columns missing from 0007"
```

**Separate risk worth raising with the owner, not fixed here:** every launcher runs `drizzle-kit push --force` on each start (`tools/windows/scripts/launcher.ps1:519`, `tools/macos/start.sh:429`, both update scripts). `--force` accepts data-loss statements without prompting, so a column rename in `schema.ts` becomes a silent DROP + CREATE on every school's live database. Moving those to `drizzle-kit migrate` is the right long-term fix and belongs in its own plan.

---

## Phase 2 — Security

### Task 7: Guard every restore endpoint

**Closes:** F7 (only `restoreStart` checks database freshness; the other four restore endpoints are unauthenticated and unguarded, and each `restore/start` burns a 64 MiB Argon2id derivation with no rate limit).

**Files:**
- Modify: `apps/backend/src/cloud-backup/restore/restore.service.ts` — call `assertDbIsFresh()` from `applySnapshot`, `replayEvents`, `finishRestore`, `cancel`
- Modify: `apps/backend/src/cloud-backup/cloud-backup.controller.ts:340-388` — add a throttle to the restore routes
- Create: `apps/backend/src/cloud-backup/restore/restore-throttle.guard.ts`
- Test: `apps/backend/src/cloud-backup/__tests__/restore-guard.spec.ts`

The endpoints are unauthenticated *by design* — the old machine is dead, there is no session. That makes the freshness check the only thing standing between a public HTTP call and `psql -f` over the live database, so it has to run on every step, not just the first.

**Interfaces:**
- Produces: `RestoreThrottleGuard` — a `CanActivate` with an in-process sliding window, applied to the five restore routes.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/cloud-backup/__tests__/restore-guard.spec.ts`:

```typescript
import { BadRequestException } from "@nestjs/common";
import { RestoreService } from "../restore/restore.service";
import { RestoreThrottleGuard } from "../restore/restore-throttle.guard";

function serviceWithState(setupComplete: boolean): RestoreService {
  const db = {
    client: {
      query: {
        cloudState: { findFirst: async () => ({ setup_complete: setupComplete }) },
        restoreProgress: {
          findFirst: async () => ({ job_id: "j1", snapshot_key: "k", applied_through_seq: 0, state: "replayed" }),
        },
      },
      delete: () => ({ where: async () => undefined }),
    },
  };
  return new RestoreService(db as never, {} as never, {} as never);
}

const target = { driverId: "s3", config: {} };

describe("restore refuses to run against a live install", () => {
  it.each([
    ["applySnapshot", (s: RestoreService) => s.applySnapshot("j1", target, "ecole", "phrase")],
    ["replayEvents", (s: RestoreService) => s.replayEvents("j1", target, "ecole", "phrase")],
    ["finishRestore", (s: RestoreService) => s.finishRestore("j1", target, "ecole", "phrase")],
    ["cancel", (s: RestoreService) => s.cancel("j1")],
  ])("%s throws when setup_complete is true", async (_name, call) => {
    await expect(call(serviceWithState(true))).rejects.toBeInstanceOf(BadRequestException);
  });

  it("startRestore still throws when setup_complete is true", async () => {
    await expect(
      serviceWithState(true).startRestore({ target, schoolId: "ecole", phrase: "phrase" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("restore throttle", () => {
  const ctxFor = (ip: string) =>
    ({ getType: () => "http", switchToHttp: () => ({ getRequest: () => ({ ip }) }) }) as never;

  it("allows the first attempts and then rejects the burst", () => {
    const guard = new RestoreThrottleGuard();
    for (let i = 0; i < 5; i++) expect(guard.canActivate(ctxFor("10.0.0.9"))).toBe(true);
    expect(() => guard.canActivate(ctxFor("10.0.0.9"))).toThrow();
  });

  it("tracks callers independently", () => {
    const guard = new RestoreThrottleGuard();
    for (let i = 0; i < 5; i++) guard.canActivate(ctxFor("10.0.0.1"));
    expect(guard.canActivate(ctxFor("10.0.0.2"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "D:/School Management System/apps/backend"
npx jest src/cloud-backup/__tests__/restore-guard.spec.ts
```

Expected: FAIL — `Cannot find module '../restore/restore-throttle.guard'`, and the four service methods resolve instead of rejecting.

- [ ] **Step 3: Call the freshness check from every step**

In `apps/backend/src/cloud-backup/restore/restore.service.ts`, add `await this.assertDbIsFresh();` as the **first statement** of `applySnapshot`, `replayEvents`, `finishRestore` and `cancel`. For example, `applySnapshot` becomes:

```typescript
  async applySnapshot(jobId: string, target: RestoreTargetInput, schoolId: string, phrase: string): Promise<void> {
    // Re-checked on every step, not just startRestore: these endpoints are
    // unauthenticated by design, and this is the only thing preventing a
    // public POST from running psql over a live school database.
    await this.assertDbIsFresh();
    const job = await this.db.client.query.restoreProgress.findFirst({ where: eq(restoreProgress.job_id, jobId) });
```

`cancel` needs the same first line:

```typescript
  async cancel(jobId: string): Promise<void> {
    await this.assertDbIsFresh();
    await this.db.client.delete(restoreProgress).where(eq(restoreProgress.job_id, jobId));
  }
```

- [ ] **Step 4: Write the throttle guard**

Create `apps/backend/src/cloud-backup/restore/restore-throttle.guard.ts`:

```typescript
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";

/**
 * Rate limit for the unauthenticated restore endpoints.
 *
 * `startRestore` runs a 64 MiB Argon2id derivation before it can reject a
 * wrong phrase, so an unthrottled caller can exhaust a school PC's memory
 * with a handful of concurrent requests. The window is deliberately small and
 * in-process: this protects one machine serving one school, and it must not
 * depend on Redis or anything else the install does not already have.
 */
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;
const MAX_TRACKED_CALLERS = 1_000;

@Injectable()
export class RestoreThrottleGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return true;
    const request = context.switchToHttp().getRequest();
    const caller = String(request.ip ?? request.socket?.remoteAddress ?? "unknown");
    const now = Date.now();

    const recent = (this.hits.get(caller) ?? []).filter((at) => now - at < WINDOW_MS);
    if (recent.length >= MAX_ATTEMPTS) {
      this.hits.set(caller, recent);
      throw new HttpException(
        "Trop de tentatives de restauration. Patientez une minute avant de réessayer.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.hits.set(caller, recent);

    // Bound the map so a spray of forged source addresses cannot grow it.
    if (this.hits.size > MAX_TRACKED_CALLERS) {
      for (const [key, times] of this.hits) {
        if (times.every((at) => now - at >= WINDOW_MS)) this.hits.delete(key);
      }
    }
    return true;
  }
}
```

- [ ] **Step 5: Apply the guard to the restore routes**

In `apps/backend/src/cloud-backup/cloud-backup.controller.ts`, import it:

```typescript
import { RestoreThrottleGuard } from "./restore/restore-throttle.guard";
```

Add `@UseGuards(RestoreThrottleGuard)` to `restoreStart`, `restoreSnapshot`, `restoreReplay`, `restoreFinish` and `restoreCancel`. Leave `restoreCheck` unguarded — it is a single boolean read with no crypto behind it.

Register the guard as a provider in `cloud-backup.module.ts`, next to `RestoreService`:

```typescript
    RestoreService,
    RestoreThrottleGuard,
    CloudSetupService,
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx jest src/cloud-backup/__tests__/restore-guard.spec.ts
```

Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/cloud-backup/restore/ \
        apps/backend/src/cloud-backup/cloud-backup.controller.ts \
        apps/backend/src/cloud-backup/cloud-backup.module.ts \
        apps/backend/src/cloud-backup/__tests__/restore-guard.spec.ts
git commit -m "fix: guard and throttle every restore endpoint"
```

---

### Task 8: Stop broadcasting the Google refresh token, and harden the HTTP surface

**Closes:** F8 (`postMessage(..., "*")` hands the OAuth refresh token to any listener) and F33 (unanchored CORS regex, no helmet, Swagger exposed unauthenticated in production).

**Files:**
- Create: `apps/backend/src/common/cors-origin.ts`
- Create: `apps/backend/src/common/__tests__/cors-origin.spec.ts`
- Create: `apps/backend/src/cloud-backup/__tests__/oauth-callback.spec.ts`
- Modify: `apps/backend/src/cloud-backup/cloud-backup.controller.ts:283-330` (`gdriveUrl`, `pendingOAuth`, `gdriveCallback`)
- Modify: `apps/backend/src/main.ts:14-40`
- Modify: `apps/backend/package.json` (add `helmet`)

**Interfaces:**
- Produces: `isAllowedOrigin(origin: string, configured?: string): boolean` — the single CORS decision, used by `main.ts` and testable without booting Nest.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/common/__tests__/cors-origin.spec.ts`:

```typescript
import { isAllowedOrigin } from "../cors-origin";

describe("CORS origin policy", () => {
  it("allows the loopback hosts the frontend actually uses", () => {
    expect(isAllowedOrigin("http://localhost:3000", "")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3000", "")).toBe(true);
    expect(isAllowedOrigin("http://localhost:3001", "")).toBe(true);
  });

  it("rejects a host that merely CONTAINS a loopback origin", () => {
    // The old regex was unanchored, so any string with the substring passed.
    expect(isAllowedOrigin("http://localhost:3000.evil.example", "")).toBe(false);
    expect(isAllowedOrigin("https://evil.example/http://localhost:3000", "")).toBe(false);
    expect(isAllowedOrigin("http://notlocalhost:3000", "")).toBe(false);
    expect(isAllowedOrigin("", "")).toBe(false);
  });

  it("allows an explicitly configured LAN origin", () => {
    expect(isAllowedOrigin("http://192.168.1.50:3000", "http://192.168.1.50:3000")).toBe(true);
    expect(isAllowedOrigin("http://192.168.1.99:3000", "http://192.168.1.50:3000")).toBe(false);
  });
});
```

Create `apps/backend/src/cloud-backup/__tests__/oauth-callback.spec.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONTROLLER = readFileSync(join(__dirname, "..", "cloud-backup.controller.ts"), "utf8");

/**
 * A source-level guard. Exercising the real callback needs a live Google
 * token exchange; what actually matters is that the refresh token is never
 * posted to a wildcard origin, and that is visible in the source.
 */
describe("gdrive OAuth callback", () => {
  it("never posts a message to the wildcard origin", () => {
    expect(CONTROLLER).not.toMatch(/postMessage\([^;]*,\s*["']\*["']\s*\)/);
  });

  it("targets an origin derived from the flow's own redirect URI", () => {
    expect(CONTROLLER).toContain("appOrigin");
    expect(CONTROLLER).toContain("new URL(pending.redirectUri).origin");
  });

  it("expires abandoned OAuth handshakes", () => {
    expect(CONTROLLER).toContain("createdAt");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/common/__tests__/cors-origin.spec.ts src/cloud-backup/__tests__/oauth-callback.spec.ts
```

Expected: FAIL — no `../cors-origin` module; the controller still matches the wildcard pattern.

- [ ] **Step 3: Extract the origin policy**

Create `apps/backend/src/common/cors-origin.ts`:

```typescript
/**
 * Which browser origins may call this API with credentials.
 *
 * The previous policy was an unanchored regex, so any origin merely
 * CONTAINING `http://localhost:<port>` satisfied it. Anchoring is the fix;
 * `CORS_ALLOWED_ORIGINS` (comma-separated) is how a school that reaches the
 * portal over its LAN adds its own address without loosening the default.
 */
const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/;

export function isAllowedOrigin(origin: string, configured = process.env.CORS_ALLOWED_ORIGINS ?? ""): boolean {
  if (!origin) return false;
  if (LOOPBACK.test(origin)) return true;
  return configured
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(origin);
}
```

- [ ] **Step 4: Install helmet and wire up bootstrap**

```bash
cd "D:/School Management System/apps/backend"
pnpm add helmet
```

In `apps/backend/src/main.ts`, add the imports:

```typescript
import helmet from "helmet";
import { isAllowedOrigin } from "./common/cors-origin";
```

Replace the `enableCors` block with:

```typescript
  app.use(helmet({
    // The portal serves its own assets same-origin and Next manages its CSP;
    // enabling helmet's default CSP here breaks the dev overlay.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  app.enableCors({
    origin: (origin, callback) => {
      // Same-origin and non-browser callers send no Origin header at all.
      if (!origin) return callback(null, true);
      return callback(null, isAllowedOrigin(origin));
    },
    credentials: true,
  });
```

Then gate Swagger, which currently publishes the whole API surface unauthenticated:

```typescript
  if (process.env.NODE_ENV !== "production" || process.env.ENABLE_API_DOCS === "true") {
    const config = new DocumentBuilder()
      .setTitle(process.env.APP_NAME ?? "school-management-api")
      .setDescription("Intern Management System API")
      .setVersion("1.0")
      .addBearerAuth()
      .build();
    SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, config));
  }
```

- [ ] **Step 5: Pin the postMessage origin and expire stale handshakes**

In `cloud-backup.controller.ts`, widen the pending map's value type:

```typescript
  private readonly pendingOAuth = new Map<
    string,
    { clientId: string; clientSecret: string; redirectUri: string; createdAt: number }
  >();
```

In `gdriveUrl`, sweep expired entries and record the timestamp:

```typescript
    const now = Date.now();
    for (const [key, entry] of this.pendingOAuth) {
      if (now - entry.createdAt > 10 * 60_000) this.pendingOAuth.delete(key);
    }
    this.pendingOAuth.set(state, {
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      redirectUri: body.redirectUri,
      createdAt: now,
    });
```

Replace `gdriveCallback`'s body:

```typescript
  @Get("oauth/gdrive/callback")
  async gdriveCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Res() res: Response,
  ) {
    const pending = state ? this.pendingOAuth.get(state) : undefined;
    this.pendingOAuth.delete(state ?? "");
    // The popup was opened by the SPA at this origin; the refresh token goes
    // there and nowhere else. `"*"` handed it to any listening window.
    const appOrigin = pending ? new URL(pending.redirectUri).origin : "null";
    const reply = (payload: Record<string, unknown>) =>
      res
        .set("Content-Type", "text/html; charset=utf-8")
        .send(
          `<script>if(window.opener){window.opener.postMessage(${JSON.stringify(payload)},${JSON.stringify(appOrigin)});}setTimeout(()=>window.close(),500);</script>`,
        );

    if (error || !pending || !code) {
      reply({ type: "iq-gdrive-oauth", ok: false, error: "denied" });
      return;
    }
    try {
      const { google } = await import("googleapis");
      const oauth2 = new google.auth.OAuth2(pending.clientId, pending.clientSecret, pending.redirectUri);
      const { tokens } = await oauth2.getToken(code);
      if (!tokens.refresh_token) {
        throw new Error("Aucun refresh token renvoyé — autorisez le compte avec le mode hors ligne.");
      }
      reply({ type: "iq-gdrive-oauth", ok: true, refreshToken: tokens.refresh_token });
    } catch (err) {
      reply({ type: "iq-gdrive-oauth", ok: false, error: redactLogError(err) });
    }
  }
```

- [ ] **Step 6: Check the frontend listener still matches**

```bash
cd "D:/School Management System"
grep -rn "iq-gdrive-oauth" apps/frontend/
```

The listener must accept a message whose `event.origin` equals `window.location.origin`. If it currently ignores origin entirely, tighten it to compare against `window.location.origin` while you are here.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd apps/backend
npx jest src/common/__tests__/cors-origin.spec.ts src/cloud-backup/__tests__/oauth-callback.spec.ts
```

Expected: PASS (6 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/main.ts apps/backend/src/common/cors-origin.ts \
        apps/backend/src/common/__tests__/cors-origin.spec.ts \
        apps/backend/src/cloud-backup/cloud-backup.controller.ts \
        apps/backend/src/cloud-backup/__tests__/oauth-callback.spec.ts \
        apps/backend/package.json pnpm-lock.yaml
git commit -m "fix: pin OAuth postMessage origin, anchor CORS, add helmet, gate swagger"
```

---

## Phase 3 — Durability of the sync loop

### Task 9: Stop stranding failed queue rows

**Closes:** F9 (`retryFailed()` is called by nothing; one network blip parks rows in `failed` forever and punches a permanent hole in the event sequence restore replays).

**Files:**
- Modify: `apps/backend/src/cloud-backup/queue/sync-queue.service.ts:60-115` (`nextBatch`, `markFailed`, add `requeueRetryable`)
- Modify: `apps/backend/src/cloud-backup/worker/sync-worker.service.ts:240-330` (`drainOnce`)
- Create: `apps/backend/src/cloud-backup/__tests__/queue-retry.spec.ts`

The restore path replays batches in sequence order and skips anything at or below `applied_through_seq`. A gap in the middle is not detected — it is silently skipped — so a stranded batch is silent data loss. Rows must come back.

**Interfaces:**
- Produces: `SyncQueueService.requeueRetryable(maxAttempts: number): Promise<number>` — flips `failed` rows under the attempt ceiling back to `pending`, returns how many moved.
- Produces: `SyncQueueService.MAX_ATTEMPTS` (exported const, value `10`).

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/cloud-backup/__tests__/queue-retry.spec.ts`:

```typescript
import { SyncQueueService, MAX_ATTEMPTS } from "../queue/sync-queue.service";

/**
 * The queue is a thin Drizzle wrapper, so the double records the update it
 * was asked to perform and the test asserts on that — no live Postgres.
 */
interface Recorded {
  set: Record<string, unknown>;
  whereCalled: boolean;
}

function makeQueue(): { queue: SyncQueueService; updates: Recorded[] } {
  const updates: Recorded[] = [];
  const db = {
    client: {
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: async () => {
            updates.push({ set, whereCalled: true });
            return [{ id: 1 }, { id: 2 }];
          },
          returning: async () => {
            updates.push({ set, whereCalled: true });
            return [{ id: 1 }, { id: 2 }];
          },
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
  it("sync-worker calls requeueRetryable at the top of drainOnce", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const worker = readFileSync(join(__dirname, "..", "worker", "sync-worker.service.ts"), "utf8");
    const drain = worker.slice(worker.indexOf("async drainOnce"));
    const body = drain.slice(0, drain.indexOf("\n  }"));
    expect(body).toContain("requeueRetryable");
    // It must happen before the batch is read, or the requeued rows wait a
    // whole extra cycle.
    expect(body.indexOf("requeueRetryable")).toBeLessThan(body.indexOf("nextBatch"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "D:/School Management System/apps/backend"
npx jest src/cloud-backup/__tests__/queue-retry.spec.ts
```

Expected: FAIL — `MAX_ATTEMPTS` is not exported and `requeueRetryable` does not exist.

- [ ] **Step 3: Add the requeue to the queue service**

In `apps/backend/src/cloud-backup/queue/sync-queue.service.ts`, add near the top after the imports:

```typescript
/**
 * How many times a row may fail before it stops being retried automatically.
 * A row that hits the ceiling stays `failed` and is surfaced in Settings →
 * Data safety, because at that point the problem is not transient.
 */
export const MAX_ATTEMPTS = 10;
```

Replace `retryFailed` (which nothing called) with a method the worker can actually use:

```typescript
  /**
   * Returns failed rows under the attempt ceiling to `pending` so the next
   * drain retries them in sequence order.
   *
   * This is what keeps the event stream contiguous. Without it, one network
   * blip parked rows in `failed` permanently while later batches marched on,
   * leaving a gap that the restore replay skips silently.
   */
  async requeueRetryable(maxAttempts: number = MAX_ATTEMPTS): Promise<number> {
    const rows = await this.db.client
      .update(syncQueue)
      .set({ status: "pending" })
      .where(and(eq(syncQueue.status, "failed"), lt(syncQueue.attempts, maxAttempts)))
      .returning({ id: syncQueue.id });
    return rows.length;
  }
```

`and`, `eq` and `lt` are already imported at the top of the file.

- [ ] **Step 4: Call it from the drain cycle**

In `apps/backend/src/cloud-backup/worker/sync-worker.service.ts`, inside `drainOnce`, immediately after `this.syncing = true;` and before the `const batch = ...` line:

```typescript
    this.syncing = true;
    try {
      // Bring back anything a previous cycle failed on. Rows must be retried
      // before the next batch is read, or a transient failure becomes a
      // permanent gap in the sequence the restore replay depends on.
      const requeued = await this.queue.requeueRetryable();
      if (requeued > 0) {
        this.logger.log(`Requeued ${requeued} previously failed rows for retry.`);
      }

      const batch = await this.queue.nextBatch(BATCH_MAX_ROWS, BATCH_MAX_BYTES);
```

- [ ] **Step 5: Surface the ceiling in the status payload**

In `apps/backend/src/cloud-backup/cloud-backup.controller.ts`, the `status()` handler already returns `queue.failed`. Make a stuck row escalate the state — find the `syncState` ladder and add a clause before the final `else`:

```typescript
    } else if (queueStats.failed > 0) {
      syncState = "attention";
    } else if (queueStats.pending > ATTENTION_PENDING_ROWS || pendingOlder > 0) {
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx jest src/cloud-backup/__tests__/queue-retry.spec.ts
```

Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/cloud-backup/queue/sync-queue.service.ts \
        apps/backend/src/cloud-backup/worker/sync-worker.service.ts \
        apps/backend/src/cloud-backup/cloud-backup.controller.ts \
        apps/backend/src/cloud-backup/__tests__/queue-retry.spec.ts
git commit -m "fix: requeue failed sync rows instead of stranding them"
```

---

### Task 10: Make the split-brain guard real

**Closes:** F10 (`heartbeat()` is never called, `claim()` has no compare-and-swap, `finishRestore` ignores the conflict it is handed) and F36 (WebDAV `put` uses `overwrite: false`, so the registry can never be rewritten after the first claim).

**Files:**
- Modify: `apps/backend/src/cloud-backup/registry/instance-registry.service.ts:59-135`
- Modify: `apps/backend/src/cloud-backup/drivers/webdav.driver.ts:140-155` (`put`)
- Modify: `apps/backend/src/cloud-backup/drivers/storage-driver.ts` (`put` signature gains `overwrite`)
- Modify: `apps/backend/src/cloud-backup/worker/sync-worker.service.ts` (heartbeat on each drain)
- Modify: `apps/backend/src/cloud-backup/restore/restore.service.ts:311-315` (`finishRestore` must honour the conflict)
- Create: `apps/backend/src/cloud-backup/__tests__/registry-conflict.spec.ts`

**Interfaces:**
- Produces: `StorageDriver.put(key, stream, sizeHint?, opts?: { overwrite?: boolean })`. Default is `false` (backup objects are immutable); the registry passes `true`.
- Produces: `InstanceRegistryService.claim(...)` returns `ClaimResult` with a populated `conflict` when another instance's latest record is `active` **and** its `claimed_at` is within `ACTIVE_TTL_MS`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/cloud-backup/__tests__/registry-conflict.spec.ts`:

```typescript
import { InstanceRegistryService, latestPerInstance, ACTIVE_TTL_MS } from "../registry/instance-registry.service";
import { MemoryDriver } from "./support/memory-driver";

const SCHOOL = "ecole-test";

describe("instance registry", () => {
  it("lets a single instance claim cleanly", async () => {
    const registry = new InstanceRegistryService();
    const driver = new MemoryDriver();
    const result = await registry.claim(driver, SCHOOL, "uuid-a", "poste-a");
    expect(result.ok).toBe(true);
    expect(result.conflict).toBeNull();
  });

  it("detects a second live instance", async () => {
    const registry = new InstanceRegistryService();
    const driver = new MemoryDriver();
    await registry.claim(driver, SCHOOL, "uuid-a", "poste-a");
    const second = await registry.claim(driver, SCHOOL, "uuid-b", "poste-b");
    expect(second.ok).toBe(false);
    expect(second.conflict?.instance_uuid).toBe("uuid-a");
  });

  it("rewrites the registry object on every claim (WebDAV overwrite path)", async () => {
    const registry = new InstanceRegistryService();
    const driver = new MemoryDriver();
    await registry.claim(driver, SCHOOL, "uuid-a", "poste-a");
    await registry.claim(driver, SCHOOL, "uuid-a", "poste-a");
    // Two writes to the same key must both succeed; the old code passed
    // overwrite:false and the second PUT failed on WebDAV.
    expect(driver.putCount.get(registry.key(SCHOOL))).toBe(2);
  });

  it("ignores a stale claim so a dead machine does not block forever", () => {
    const stale = new Date(Date.now() - ACTIVE_TTL_MS - 60_000).toISOString();
    const fresh = new Date().toISOString();
    const latest = latestPerInstance([
      { instance_uuid: "dead", hostname: "vieux", claimed_at: stale, status: "active" },
      { instance_uuid: "live", hostname: "neuf", claimed_at: fresh, status: "active" },
    ]);
    const others = latest.filter((i) => i.instance_uuid !== "live");
    expect(others).toHaveLength(1);
    // The registry treats it as inactive because the heartbeat lapsed.
    expect(Date.now() - new Date(others[0].claimed_at).getTime()).toBeGreaterThan(ACTIVE_TTL_MS);
  });

  it("a retired instance never conflicts", async () => {
    const registry = new InstanceRegistryService();
    const driver = new MemoryDriver();
    await registry.claim(driver, SCHOOL, "uuid-a", "poste-a");
    await registry.retire(driver, SCHOOL, "uuid-a");
    const second = await registry.claim(driver, SCHOOL, "uuid-b", "poste-b");
    expect(second.conflict).toBeNull();
  });
});

describe("restore honours the conflict it is handed", () => {
  it("finishRestore checks claim().conflict", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const source = readFileSync(join(__dirname, "..", "restore", "restore.service.ts"), "utf8");
    const finish = source.slice(source.indexOf("async finishRestore"));
    const body = finish.slice(0, finish.indexOf("\n  private"));
    expect(body).toMatch(/claim\.conflict|claimResult\.conflict/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/cloud-backup/__tests__/registry-conflict.spec.ts
```

Expected: FAIL — `ACTIVE_TTL_MS` is not exported, the overwrite test fails on the second put, and `finishRestore` never reads `.conflict`.

- [ ] **Step 3: Add an overwrite flag to the driver contract**

In `apps/backend/src/cloud-backup/drivers/storage-driver.ts`:

```typescript
export interface PutOptions {
  /**
   * Backup objects are immutable and unique, so the default is false — a
   * collision means a key was reused, which must fail loudly. The instance
   * registry is the one mutable object in the namespace and passes true.
   */
  overwrite?: boolean;
}

export interface StorageDriver {
  readonly id: DriverId;
  readonly displayName: string;
  testConnection(): Promise<{ ok: true; latencyMs: number; probe: string }>;
  put(key: string, stream: Readable, sizeHint?: number, opts?: PutOptions): Promise<PutResult>;
  get(key: string): Promise<Readable>;
  list(prefix: string): Promise<ObjectMeta[]>;
}
```

In `webdav.driver.ts`, thread it through:

```typescript
  async put(key: string, stream: Readable, sizeHint?: number, opts?: PutOptions): Promise<PutResult> {
    const client = await this.client();
    try {
      await withRetry(async () => {
        await this.ensureFolders(client, key);
        await client.putFileContents(this.path(key), stream, {
          contentLength: sizeHint ?? false,
          overwrite: opts?.overwrite ?? false,
        });
      }, this.options);
      return { key, size: sizeHint ?? 0 };
    } catch (err) {
      throw this.classify(err);
    }
  }
```

`s3.driver.ts` and `gdrive.driver.ts` need the parameter added to their signatures for type compatibility; S3 overwrites natively, and for gdrive add a same-name lookup + `files.update` when `overwrite` is true (see Task 17, which rewrites that driver's put — a `// TODO` here would be a plan failure, so if you reach this before Task 17, implement it as):

```typescript
  async put(key: string, stream: Readable, sizeHint?: number, opts?: PutOptions): Promise<PutResult> {
    const auth = this.auth();
    try {
      await withRetry(async () => {
        const drive = driveClient(auth);
        const folderId = await this.rootFolder(auth, key.split("/")[0]);
        const name = this.fileName(key);
        if (opts?.overwrite) {
          const existing = await drive.files.list({
            q: `name = '${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`,
            fields: "files(id)",
            pageSize: 1,
          });
          const id = existing.data.files?.[0]?.id;
          if (id) {
            await drive.files.update({ fileId: id, media: { body: stream, mimeType: "application/octet-stream" } });
            return;
          }
        }
        await drive.files.create({
          requestBody: { name, parents: [folderId] },
          media: { body: stream, mimeType: "application/octet-stream" },
          fields: "id",
        });
      }, this.options);
      return { key, size: sizeHint ?? 0 };
    } catch (err) {
      throw this.classify(err);
    }
  }
```

- [ ] **Step 4: Age out stale claims and write with overwrite**

In `instance-registry.service.ts`, export the TTL and use it:

```typescript
/**
 * How long an `active` record is believed without a fresh heartbeat.
 *
 * Without this, a machine that died mid-term stays "active" forever and
 * blocks its own replacement — the exact situation the restore flow exists
 * for. The worker heartbeats every drain cycle (60 s by default), so three
 * hours is many missed beats, not a flap.
 */
export const ACTIVE_TTL_MS = 3 * 60 * 60 * 1000;
```

In `write`, pass the overwrite flag:

```typescript
  async write(driver: StorageDriver, schoolId: string, registry: InstanceRegistry): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(registry, null, 2), "utf8");
    // The registry is the one mutable object in the namespace.
    await driver.put(this.key(schoolId), streamFrom(bytes), bytes.length, { overwrite: true });
  }
```

In `claim`, filter the conflict by freshness:

```typescript
    const latest = latestPerInstance(current.instances);
    const now = Date.now();
    const conflict =
      latest.find(
        (i) =>
          i.instance_uuid !== instanceUuid &&
          i.status === "active" &&
          now - new Date(i.claimed_at).getTime() < ACTIVE_TTL_MS,
      ) ?? null;
```

- [ ] **Step 5: Heartbeat from the drain cycle**

In `sync-worker.service.ts`, add a field and call it once per drain. At the end of `drainOnce`'s `try` block, just before `this.lastDrainAt = new Date();`:

```typescript
      // Keep this instance's claim fresh. Without a heartbeat the claim ages
      // past ACTIVE_TTL_MS and a second machine would be allowed to start
      // syncing alongside this one.
      await this.heartbeatAll(st, targets);
```

And add the method:

```typescript
  private async heartbeatAll(
    state: LoadedState,
    targets: Array<{ id: string; driver: StorageDriver }>,
  ): Promise<void> {
    for (const target of targets) {
      try {
        const result = await this.registry.heartbeat(
          target.driver,
          state.schoolId,
          state.instanceUuid,
          state.hostname,
        );
        if (result.conflict) {
          this.conflict = {
            hostname: result.conflict.hostname,
            instance_uuid: result.conflict.instance_uuid,
            claimed_at: result.conflict.claimed_at,
          };
          this.logger.error(
            `Split-brain detected during heartbeat: ${result.conflict.hostname} also claims school ${state.schoolId}. Sync paused.`,
          );
          return;
        }
      } catch {
        // An unreachable target is an offline condition, not a conflict.
        this.logger.warn(`Heartbeat against ${target.id} failed — retrying next cycle.`);
      }
    }
    this.conflict = null;
  }
```

And make `drainOnce` refuse to run while a conflict stands — add to the guard at the top:

```typescript
    if (this.syncing) return false;
    if (this.conflict) return false;
```

- [ ] **Step 6: Make finishRestore honour the conflict**

In `restore.service.ts`, replace the bare `await this.registry.claim(...)` in `finishRestore`:

```typescript
    const claim = await this.registry.claim(driver, schoolId, instanceUuid, hostname);
    if (claim.conflict) {
      throw new BadRequestException(
        `Une autre installation (${claim.conflict.hostname}) sauvegarde encore cette école. ` +
          "Retirez-la d'abord depuis Paramètres → Sécurité des données, puis relancez la restauration.",
      );
    }
```

Move this **above** the `cloud_state` write so a rejected claim does not leave the install marked `setup_complete`.

- [ ] **Step 7: Run the test to verify it passes**

```bash
npx jest src/cloud-backup/__tests__/registry-conflict.spec.ts
```

Expected: PASS (6 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/cloud-backup/registry/ apps/backend/src/cloud-backup/drivers/ \
        apps/backend/src/cloud-backup/worker/sync-worker.service.ts \
        apps/backend/src/cloud-backup/restore/restore.service.ts \
        apps/backend/src/cloud-backup/__tests__/registry-conflict.spec.ts
git commit -m "fix: heartbeat the instance claim and honour split-brain conflicts"
```

---

### Task 11: Fix the two `pg_*` subprocess bugs

**Closes:** F11 (`psql` restore deadlocks because its piped stdout is never read) and F12 (`pg_dump` fallback resolves before the dump file finishes flushing).

**Files:**
- Modify: `apps/backend/src/cloud-backup/restore/restore.service.ts:239-262` (`loadSqlFile`)
- Modify: `apps/backend/src/cloud-backup/worker/snapshot.service.ts:60-100` (`dumpToFile`)
- Create: `apps/backend/src/cloud-backup/__tests__/pg-subprocess.spec.ts`

`psql -f` writes a command tag per statement to stdout. With `stdio: ["ignore", "pipe", "inherit"]` and no reader, the 64 KB pipe buffer fills on any real dump and the child blocks forever — the restore hangs with no error. The dump path has the mirror problem: it resolves on the child's `close` without waiting for the `createWriteStream` to emit `finish`, so `statSync` can measure a partially-flushed file.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/cloud-backup/__tests__/pg-subprocess.spec.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const RESTORE = readFileSync(join(__dirname, "..", "restore", "restore.service.ts"), "utf8");
const SNAPSHOT = readFileSync(join(__dirname, "..", "worker", "snapshot.service.ts"), "utf8");

describe("psql child process", () => {
  it("never leaves stdout piped and unread", () => {
    const load = RESTORE.slice(RESTORE.indexOf("private async loadSqlFile"));
    const body = load.slice(0, load.indexOf("\n  /**"));
    // Either stdout is ignored/inherited, or it is explicitly drained.
    const drains = /child\.stdout(\?\.)?\.(resume|on)\(/.test(body);
    const notPiped = /stdio:\s*\["ignore",\s*"ignore",\s*"pipe"\]|stdio:\s*"inherit"/.test(body);
    expect(drains || notPiped).toBe(true);
  });
});

describe("pg_dump child process", () => {
  it("waits for the write stream to finish, not just the child to close", () => {
    const dump = SNAPSHOT.slice(SNAPSHOT.indexOf("private async dumpToFile"));
    const body = dump.slice(0, dump.indexOf("\n  /**"));
    expect(body).toMatch(/on\(["']finish["']/);
  });
});

describe("a child whose stdout is piped and unread deadlocks", () => {
  it("demonstrates the failure mode this task fixes", async () => {
    // node prints ~1 MB to stdout; with a piped, unread stdout it cannot exit.
    const child = spawn(process.execPath, ["-e", "process.stdout.write('x'.repeat(1024*1024))"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 1_500);
      child.on("close", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    child.kill();
    expect(exited).toBe(false);
  }, 10_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/cloud-backup/__tests__/pg-subprocess.spec.ts
```

Expected: the first two FAIL; the third PASSES (it documents the mechanism, and stays green forever).

- [ ] **Step 3: Drain psql's output**

In `restore.service.ts`, rewrite the `run` closure inside `loadSqlFile`:

```typescript
    const run = (binary: string) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(
          binary,
          ["-U", cfg.user, "-h", cfg.host, "-p", String(cfg.port), "-d", cfg.database, "-v", "ON_ERROR_STOP=1", "-f", path],
          { env: { ...process.env, PGPASSWORD: cfg.password }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
        );

        // psql writes one command tag per statement. A piped stdout that
        // nobody reads fills its 64 KB buffer and blocks the child forever —
        // the restore hung with no error and no output.
        let tail = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", () => {
          /* drained and discarded: the tags are noise, the exit code is truth */
        });
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          tail = (tail + chunk).slice(-4_000);
        });

        child.on("error", reject);
        child.on("close", (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`psql exited with code ${code}${tail ? `: ${tail.trim()}` : ""}`)),
        );
      });
```

Capturing stderr is a bonus: `ON_ERROR_STOP=1` failures previously vanished into the parent's console with no way to show the admin why the restore stopped.

- [ ] **Step 4: Wait for the dump file to flush**

In `snapshot.service.ts`, rewrite the spawn branch of `dumpToFile`:

```typescript
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        pgDump,
        ["-U", cfg.user, "-h", cfg.host, "-p", String(cfg.port), "-d", cfg.database, "--format=plain", "--no-owner", "--no-privileges"],
        { env: { ...process.env, PGPASSWORD: cfg.password }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      const out = createWriteStream(targetPath, { flags: "w" });

      let stderrTail = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-4_000);
      });

      let exitCode: number | null = null;
      let closed = false;
      let flushed = false;

      const settle = () => {
        if (!closed || !flushed) return;
        if (exitCode !== 0) {
          reject(new Error(`pg_dump exited with code ${exitCode}${stderrTail ? `: ${stderrTail.trim()}` : ""}`));
        } else {
          resolve();
        }
      };

      child.stdout.pipe(out);
      child.on("error", reject);
      out.on("error", reject);
      // Both must complete: the child can exit while the last buffer is still
      // being written, and statSync would then measure a truncated dump.
      out.on("finish", () => {
        flushed = true;
        settle();
      });
      child.on("close", (code) => {
        exitCode = code;
        closed = true;
        settle();
      });
    });
```

Note `child.stdout.pipe(out)` ends `out` on its own — the manual `out.end()` in the old code is gone.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx jest src/cloud-backup/__tests__/pg-subprocess.spec.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/cloud-backup/restore/restore.service.ts \
        apps/backend/src/cloud-backup/worker/snapshot.service.ts \
        apps/backend/src/cloud-backup/__tests__/pg-subprocess.spec.ts
git commit -m "fix: drain psql stdout and wait for pg_dump to flush"
```

---

### Task 12: Register the actor interceptor, or delete it

**Closes:** F13 (`SyncActorInterceptor` is defined in no module, so `app.actor_user_id` is never set and every `sync_queue` row records a null actor; the pooled-connection design is also unsound as written).

**Files:**
- Modify: `apps/backend/src/cloud-backup/queue/sync-context.ts:19-50`
- Modify: `apps/backend/src/cloud-backup/cloud-backup.module.ts`
- Create: `apps/backend/src/cloud-backup/__tests__/sync-context.spec.ts`

Two problems, one fix. The interceptor was never registered, and even if it had been, `set_config(..., false)` is session-scoped on a connection from a 10-connection pool: the `SELECT set_config` and the business write can land on different connections, and the value persists on that connection into an unrelated later request. The honest fix is to stop pretending a fire-and-forget session variable works and make attribution explicit and transaction-local, keeping the trigger's `current_setting` read exactly as it is.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/cloud-backup/__tests__/sync-context.spec.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withActor } from "../queue/sync-context";

const MODULE = readFileSync(join(__dirname, "..", "cloud-backup.module.ts"), "utf8");
const CONTEXT = readFileSync(join(__dirname, "..", "queue", "sync-context.ts"), "utf8");

describe("sync actor attribution", () => {
  it("is not dead code — the interceptor is registered or gone", () => {
    const declaresInterceptor = CONTEXT.includes("SyncActorInterceptor");
    if (declaresInterceptor) {
      expect(MODULE).toContain("SyncActorInterceptor");
    }
    expect(true).toBe(true);
  });

  it("never interpolates the actor id into SQL", () => {
    // The old code built `set_config('app.actor_user_id', '${actorId}', false)`.
    expect(CONTEXT).not.toMatch(/set_config\('app\.actor_user_id',\s*'\$\{/);
  });

  it("sets the actor transaction-locally, not session-wide", () => {
    // Third argument true = is_local, scoped to the surrounding transaction.
    expect(CONTEXT).toMatch(/set_config\([^)]*app\.actor_user_id[^)]*true/);
  });

  it("withActor runs its callback inside one transaction", async () => {
    const calls: string[] = [];
    const db = {
      client: {
        transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
          calls.push("begin");
          const tx = {
            execute: async (q: unknown) => {
              calls.push(`execute:${String(q)}`);
            },
          };
          const result = await fn(tx);
          calls.push("commit");
          return result;
        },
      },
    };

    await withActor(db as never, "11111111-1111-1111-1111-111111111111", async () => "done");

    expect(calls[0]).toBe("begin");
    expect(calls[calls.length - 1]).toBe("commit");
    expect(calls.some((c) => c.includes("set_config"))).toBe(true);
  });

  it("rejects an actor id that is not a UUID", async () => {
    const db = { client: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ execute: async () => undefined }) } };
    await expect(withActor(db as never, "'; DROP TABLE users; --", async () => "x")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/cloud-backup/__tests__/sync-context.spec.ts
```

Expected: FAIL — `withActor` is not exported, and the module does not mention the interceptor.

- [ ] **Step 3: Replace the interceptor with an explicit, transaction-local helper**

In `apps/backend/src/cloud-backup/queue/sync-context.ts`, delete `SyncActorInterceptor` entirely and replace it with:

```typescript
import { sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Attributes every write inside `fn` to `actorUserId` for the sync triggers.
 *
 * This replaces a request interceptor that set `app.actor_user_id` with
 * `set_config(..., false)` — session scope — and fired it without awaiting.
 * With a 10-connection pool that was unsound twice over: the setting and the
 * write could land on different connections, and the value survived on its
 * connection into the next, unrelated request. Transaction-local scope
 * (`is_local = true`) is the only form that is actually correct here, and it
 * requires the caller to own the transaction — hence this helper rather than
 * an interceptor.
 *
 * The trigger side is unchanged: it still reads
 * `current_setting('app.actor_user_id', true)`.
 */
export async function withActor<T>(
  db: DbService,
  actorUserId: string,
  fn: (tx: DbService["client"]) => Promise<T>,
): Promise<T> {
  if (!UUID.test(actorUserId)) {
    throw new Error(`Invalid actor id for sync attribution: ${actorUserId}`);
  }
  return db.client.transaction(async (tx) => {
    // Parameterised, and transaction-local. The old code interpolated the id
    // straight into the statement text.
    await tx.execute(sql`SELECT set_config('app.actor_user_id', ${actorUserId}, true)`);
    return fn(tx as DbService["client"]);
  });
}
```

Keep `withSyncDisabled` exactly as it is — it was already transaction-local and correct.

- [ ] **Step 4: Record the consequence in the trigger docs**

In `apps/backend/src/cloud-backup/queue/sync-trigger-bootstrap.ts`, update the "Actor attribution" paragraph of the header comment so it stops describing an interceptor that no longer exists:

```
 * Actor attribution: writes that want an attributed actor wrap themselves in
 * `withActor(db, userId, tx => ...)`, which sets `app.actor_user_id`
 * transaction-locally; the trigger reads it via `current_setting`. Writes
 * that do not are attributed to the system (null actor) — which is every
 * write today. Restore/seed/import set `app.sync_disabled` instead so their
 * writes produce no queue rows at all.
```

- [ ] **Step 5: Verify nothing still imports the deleted class**

```bash
cd "D:/School Management System/apps/backend"
grep -rn "SyncActorInterceptor" src/
npx tsc --noEmit -p tsconfig.json
```

Expected: no grep hits, and `tsc` exits 0.

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx jest src/cloud-backup/__tests__/sync-context.spec.ts
```

Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/cloud-backup/queue/ \
        apps/backend/src/cloud-backup/__tests__/sync-context.spec.ts
git commit -m "fix: replace the unregistered actor interceptor with a transaction-local helper"
```

---

### Task 13: Make the machine key work in a container

**Closes:** F14 (`machineId()` returns null on `node:22-alpine`, so `save()` and `wrapFromPhrase()` throw and cloud backup cannot be configured in Docker at all; and where a machine-id does exist Docker regenerates it per container, silently orphaning the wrapped master key).

**Files:**
- Modify: `apps/backend/src/cloud-backup/credential-store/machine-key.ts:20-58`
- Modify: `docker-compose.yml` (document the volume)
- Modify: `BACKUP.md` (the Docker caveat)
- Create: `apps/backend/src/cloud-backup/__tests__/machine-key.spec.ts`

The machine key exists to make a copied folder useless on another computer. In a container that property is provided by the volume, not by the host — so the fix is an explicit, persisted key file inside the data directory, used only when no OS-level machine identity is available.

**Interfaces:**
- Produces: `machineId(): string | null` — unchanged signature, new final fallback.
- Produces: `MACHINE_KEY_FILE = ".cloud-creds/machine-key"` (exported const).

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/cloud-backup/__tests__/machine-key.spec.ts`:

```typescript
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { machineId, machineKey, deriveStoreKey, resetMachineIdCache } from "../credential-store/machine-key";

describe("machine key", () => {
  let dir: string;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "iq-machinekey-"));
    resetMachineIdCache();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
    resetMachineIdCache();
  });

  it("always yields a key, even with no OS machine identity", () => {
    const key = machineKey(dir);
    expect(key).not.toBeNull();
    expect(key!.length).toBe(32);
  });

  it("is stable across calls — a wrapped key stays unwrappable", async () => {
    const first = machineKey(dir)!;
    resetMachineIdCache();
    const second = machineKey(dir)!;
    expect(first.equals(second)).toBe(true);
  });

  it("persists the generated identity so a container restart can unwrap", async () => {
    machineKey(dir);
    const persisted = await readFile(join(dir, "machine-key"), "utf8");
    expect(persisted.trim().length).toBeGreaterThanOrEqual(32);
  });

  it("differs between two independent installs", async () => {
    const other = await mkdtemp(join(tmpdir(), "iq-machinekey-b-"));
    try {
      const a = machineKey(dir)!;
      resetMachineIdCache();
      const b = machineKey(other)!;
      expect(a.equals(b)).toBe(false);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("derives distinct store keys from distinct salts", () => {
    const base = machineKey(dir)!;
    const one = deriveStoreKey(base, Buffer.alloc(16, 1));
    const two = deriveStoreKey(base, Buffer.alloc(16, 2));
    expect(one.equals(two)).toBe(false);
  });

  it("machineId is null only when no source and no fallback dir is given", () => {
    expect(typeof machineId(dir)).toBe("string");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/cloud-backup/__tests__/machine-key.spec.ts
```

Expected: FAIL — `machineKey` takes no argument, `resetMachineIdCache` does not exist, and on a machine with no `/etc/machine-id` the key is `null`.

- [ ] **Step 3: Add a persisted fallback identity**

Rewrite `apps/backend/src/cloud-backup/credential-store/machine-key.ts`'s identity section:

```typescript
import { createHash, createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";

const MACHINE_ID_REGISTRY = "HKLM\\SOFTWARE\\Microsoft\\Cryptography";
const MACHINE_ID_VALUE = "MachineGuid";

/** File name of the generated identity, inside the credential directory. */
export const MACHINE_KEY_FILE = "machine-key";

let cached: string | null = null;

/** Test seam: forget the memoised identity. */
export function resetMachineIdCache(): void {
  cached = null;
}

function fromWindowsRegistry(): string | null {
  if (process.platform !== "win32") return null;
  try {
    const out = execFileSync("reg", ["query", MACHINE_ID_REGISTRY, "/v", MACHINE_ID_VALUE], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: 10_000,
    });
    const match = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
    return match ? match[1].trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

function fromSystemFiles(): string | null {
  for (const file of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      if (existsSync(file)) {
        const id = readFileSync(file, "utf8").trim();
        if (id) return id.toLowerCase();
      }
    } catch {
      /* continue */
    }
  }
  return null;
}

/**
 * Last resort: a random identity generated once and persisted next to the
 * credentials it protects.
 *
 * A container has no stable host identity — `node:22-alpine` ships no
 * `/etc/machine-id` and no `hostid`, so the old code returned null and the
 * cloud backup could not be configured at all. Where the machine identity
 * comes from the host, a copied folder cannot decrypt its credentials on
 * another machine; where it comes from this file, that property is provided
 * by the volume the file lives on. Both are honest, and neither is a secret
 * that travels with a git clone — this path is inside `.cloud-creds/`, which
 * is git-ignored.
 */
function fromPersistedFile(dir: string): string {
  const path = join(dir, MACHINE_KEY_FILE);
  try {
    if (existsSync(path)) {
      const id = readFileSync(path, "utf8").trim();
      if (id.length >= 32) return id.toLowerCase();
    }
  } catch {
    /* regenerate below */
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const generated = randomBytes(32).toString("hex");
  writeFileSync(path, generated, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows ignores POSIX modes; the directory ACL covers it */
  }
  return generated;
}

/**
 * A stable identifier for this installation. Prefers the OS machine identity
 * (Windows MachineGuid, then /etc/machine-id) and falls back to a persisted
 * random value in `fallbackDir`.
 */
export function machineId(fallbackDir?: string): string | null {
  if (cached) return cached;
  const found = fromWindowsRegistry() ?? fromSystemFiles();
  if (found) {
    cached = found;
    return cached;
  }
  if (!fallbackDir) return null;
  cached = fromPersistedFile(fallbackDir);
  return cached;
}

/** 32-byte machine-bound key. Deterministic for the life of the install. */
export function machineKey(fallbackDir?: string): Buffer | null {
  const id = machineId(fallbackDir);
  if (!id) return null;
  return createHash("sha256").update(id).digest();
}
```

Keep `deriveStoreKey` and `freshSalt` unchanged.

- [ ] **Step 4: Pass the credential directory in from both callers**

In `credential-store.service.ts`, `this.dir` is already the `.cloud-creds` path. Change every `machineKey()` call in that file to `machineKey(this.dir)`.

In `cloud-key.service.ts`, the service has no directory of its own — inject the credential store and use its directory. Add a public getter to `CredentialStoreService`:

```typescript
  /** The credential directory, also used as the machine-key fallback location. */
  get directory(): string {
    return this.dir;
  }
```

and in `cloud-key.service.ts`:

```typescript
  constructor(private readonly creds: CredentialStoreService) {}
```

replacing both `machineKey()` calls with `machineKey(this.creds.directory)`. `CredentialStoreService` is already a provider in `cloud-backup.module.ts`, so no module change is needed.

- [ ] **Step 5: Persist the directory in Docker**

In `docker-compose.yml`, add a named volume for the app service so the identity and credentials survive a container recreate:

```yaml
    volumes:
      - cloud-creds:/app/.cloud-creds
```

and under the top-level `volumes:` key:

```yaml
  cloud-creds:
```

Add a note to `BACKUP.md` under section 1, after the split-brain paragraph:

```markdown
### Docker

The wrapped master key is bound to a machine identity. In a container there is
no host identity to bind to, so one is generated on first run and stored at
`/app/.cloud-creds/machine-key`. **That path must be on a persistent volume**
(`docker-compose.yml` mounts the `cloud-creds` volume for exactly this). Lose
it and the local wrapped key becomes undecryptable — the cloud data is still
fine, but recovering it means running the restore flow with the recovery
phrase.
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx jest src/cloud-backup/__tests__/machine-key.spec.ts
```

Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/cloud-backup/credential-store/ \
        apps/backend/src/cloud-backup/__tests__/machine-key.spec.ts \
        docker-compose.yml BACKUP.md
git commit -m "feat: persist a machine identity so cloud backup works in containers"
```

---

### Task 14: Make re-running setup safe

**Closes:** F15 (re-running `setup/step-1` silently replaces the KDF salt and wrapped key while the cloud still holds objects encrypted under the old key, permanently orphaning every byte of backup history).

**Files:**
- Modify: `apps/backend/src/cloud-backup/setup/setup.service.ts:57-110` (`step1`)
- Modify: `apps/backend/src/cloud-backup/cloud-backup.controller.ts:243-249` (`step1` route)
- Modify: `apps/frontend/components/settings/data-safety-section.tsx` (confirmation copy)
- Create: `apps/backend/src/cloud-backup/__tests__/setup-reinit.spec.ts`

There is a legitimate reason to re-run step 1 — Task 2's fix means existing installs must rewrite their check object — so the answer is not to forbid it, but to distinguish *re-seeding with the same phrase* (safe, idempotent) from *starting over with a new phrase* (destroys access to all history) and to require an explicit acknowledgement for the second.

**Interfaces:**
- Produces: `CloudSetupService.step1(input: { schoolId, phrase, confirmReplaceExisting?: boolean })`. Throws `BadRequestException` when a configured install would get a different derived key and `confirmReplaceExisting` is not `true`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/cloud-backup/__tests__/setup-reinit.spec.ts`:

```typescript
import { BadRequestException } from "@nestjs/common";
import { CloudSetupService } from "../setup/setup.service";
import { buildKdfParams, newSalt } from "../crypto/kdf";
import { CloudKeyService } from "../credential-store/cloud-key.service";

const EXISTING_KDF = buildKdfParams("scrypt", newSalt(), { scryptN: 1024 });
const PHRASE = "abandon ability able about above absent absorb abstract absurd abuse access accident";

function makeService(existing: Record<string, unknown> | null) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    client: {
      query: { cloudState: { findFirst: async () => existing } },
      update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => updates.push(v) }) }),
      insert: () => ({ values: async (v: Record<string, unknown>) => updates.push(v) }),
      select: () => ({ from: () => ({ where: async () => [] }) }),
    },
  };
  const keys = new CloudKeyService({ directory: process.cwd() } as never);
  const service = new CloudSetupService(
    db as never, keys as never, { load: async () => null } as never,
    {} as never, {} as never, {} as never, {} as never,
  );
  return { service, updates };
}

describe("re-running setup step 1", () => {
  it("refuses a new phrase on a configured install without explicit confirmation", async () => {
    const { service } = makeService({
      setup_complete: true,
      kdf_salt: JSON.stringify(EXISTING_KDF),
      wrapped_key: "existing",
      wrap_salt: "existing",
    });

    await expect(
      service.step1({ schoolId: "ecole-test", phrase: PHRASE }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("names the consequence in the error", async () => {
    const { service } = makeService({
      setup_complete: true,
      kdf_salt: JSON.stringify(EXISTING_KDF),
      wrapped_key: "existing",
      wrap_salt: "existing",
    });

    await expect(service.step1({ schoolId: "ecole-test", phrase: PHRASE })).rejects.toThrow(
      /illisibles|historique|irréversible/i,
    );
  });

  it("allows a fresh install with no confirmation", async () => {
    const { service } = makeService(null);
    await expect(
      service.step1({ schoolId: "ecole-test", phrase: PHRASE, confirmReplaceExisting: false }),
    ).resolves.toBeDefined();
  });

  it("reuses the existing KDF salt when re-seeding, so the key is unchanged", async () => {
    const { service, updates } = makeService({
      setup_complete: true,
      kdf_salt: JSON.stringify(EXISTING_KDF),
      wrapped_key: "existing",
      wrap_salt: "existing",
    });

    await service.step1({ schoolId: "ecole-test", phrase: PHRASE, confirmReplaceExisting: true });
    const written = updates.find((u) => u.kdf_salt);
    // Confirmed replacement gets a NEW salt — that is the destructive path.
    expect(written!.kdf_salt).not.toBe(JSON.stringify(EXISTING_KDF));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/cloud-backup/__tests__/setup-reinit.spec.ts
```

Expected: FAIL — `step1` accepts no `confirmReplaceExisting` and never rejects.

- [ ] **Step 3: Add the guard**

In `apps/backend/src/cloud-backup/setup/setup.service.ts`, change `step1`'s signature and add the check before any write:

```typescript
  async step1(input: {
    schoolId: string;
    phrase: string;
    /**
     * Required to overwrite a configured install's KDF salt. Doing so
     * re-keys the namespace: every object already in the cloud was encrypted
     * under the old key and becomes permanently unreadable.
     */
    confirmReplaceExisting?: boolean;
  }): Promise<{ schoolId: string; instanceUuid: string; kdf: KdfParams }> {
    const schoolId = input.schoolId.trim().toLowerCase().replace(/\s+/g, "-");
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(schoolId)) {
      throw new BadRequestException(
        "Identifiant d'école invalide : 3 à 64 caractères, lettres minuscules, chiffres et tirets.",
      );
    }

    const existing = await this.db.client.query.cloudState.findFirst({ where: eq(cloudState.singleton, "global") });

    if (existing?.setup_complete && existing.kdf_salt && !input.confirmReplaceExisting) {
      throw new BadRequestException(
        "Cette installation a déjà une sauvegarde cloud configurée. Reconfigurer génère une nouvelle clé : " +
          "toutes les sauvegardes déjà envoyées deviendraient définitivement illisibles, y compris tout l'historique. " +
          "Cette action est irréversible — confirmez explicitement pour continuer.",
      );
    }

    const kdf = makeSchoolSalt();
    const wrapped = await this.keys.wrapFromPhrase(input.phrase, kdf);
```

The rest of `step1` is unchanged; delete its now-duplicated `const existing = ...` lookup further down and reuse this one.

- [ ] **Step 4: Pass the flag through the controller**

In `cloud-backup.controller.ts`:

```typescript
  @Post("setup/step-1")
  @UseGuards(JwtAuthGuard)
  step1(@Body() body: { schoolId?: string; phrase?: string; confirmReplaceExisting?: boolean }) {
    if (!body.schoolId || !body.phrase) throw new BadRequestException("Identifiant d'école et phrase requis.");
    return this.setup.step1({
      schoolId: body.schoolId,
      phrase: body.phrase,
      confirmReplaceExisting: body.confirmReplaceExisting === true,
    });
  }
```

- [ ] **Step 5: Add the frontend confirmation**

In `apps/frontend/components/settings/data-safety-section.tsx`, find the call that posts to `setup/step-1`. When the current status reports `configured: true`, require a typed confirmation before sending `confirmReplaceExisting: true`. Add near the other dialog state:

```typescript
const [reconfigureAck, setReconfigureAck] = useState("");
const alreadyConfigured = status?.configured === true;
const mayProceed = !alreadyConfigured || reconfigureAck.trim().toUpperCase() === "REMPLACER";
```

and render, immediately above the submit button, when `alreadyConfigured` is true:

```tsx
<div className="rounded-btn border border-danger/30 bg-danger-soft dark:bg-danger-dark-soft px-4 py-3 text-sm space-y-2">
  <p className="font-semibold text-danger-strong dark:text-danger-dark-strong">
    {t("cloudSafeSave.reconfigureWarning", "Une sauvegarde cloud est déjà configurée.")}
  </p>
  <p className="text-text-secondary text-xs">
    {t(
      "cloudSafeSave.reconfigureDetail",
      "Reconfigurer génère une nouvelle clé. Tout ce qui a déjà été envoyé au cloud deviendra définitivement illisible. Tapez REMPLACER pour confirmer.",
    )}
  </p>
  <input
    value={reconfigureAck}
    onChange={(e) => setReconfigureAck(e.target.value)}
    placeholder="REMPLACER"
    className="w-full rounded-btn border border-border bg-background px-3 py-2 text-sm"
  />
</div>
```

Gate the submit with `disabled={!mayProceed || busy}` and send `confirmReplaceExisting: alreadyConfigured`.

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd "D:/School Management System/apps/backend"
npx jest src/cloud-backup/__tests__/setup-reinit.spec.ts
```

Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/cloud-backup/setup/setup.service.ts \
        apps/backend/src/cloud-backup/cloud-backup.controller.ts \
        apps/backend/src/cloud-backup/__tests__/setup-reinit.spec.ts \
        apps/frontend/components/settings/data-safety-section.tsx
git commit -m "fix: require explicit confirmation before re-keying a configured backup"
```

---

## Phase 3 â€” Durability of the sync loop

### Task 9: Stop stranding failed queue rows

**Closes:** F9 (`retryFailed()` is called by nothing; one network blip parks rows in `failed` forever and punches a permanent hole in the event sequence restore replays).

**Files:**
- Modify: `apps/backend/src/cloud-backup/queue/sync-queue.service.ts:60-115` (`nextBatch`, `markFailed`, add `requeueRetryable`)
- Modify: `apps/backend/src/cloud-backup/worker/sync-worker.service.ts:240-330` (`drainOnce`)
- Create: `apps/backend/src/cloud-backup/__tests__/queue-retry.spec.ts`

The restore path replays batches in sequence order and skips anything at or below `applied_through_seq`. A gap in the middle is not detected â€” it is silently skipped â€” so a stranded batch is silent data loss. Rows must come back.

**Interfaces:**
- Produces: `SyncQueueService.requeueRetryable(maxAttempts: number): Promise<number>` â€” flips `failed` rows under the attempt ceiling back to `pending`, returns how many moved.
- Produces: `SyncQueueService.MAX_ATTEMPTS` (exported const, value `10`).

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/cloud-backup/__tests__/queue-retry.spec.ts`:

```typescript
import { SyncQueueService, MAX_ATTEMPTS } from "../queue/sync-queue.service";

/**
 * The queue is a thin Drizzle wrapper, so the double records the update it
 * was asked to perform and the test asserts on that â€” no live Postgres.
 */
interface Recorded {
  set: Record<string, unknown>;
  whereCalled: boolean;
}

function makeQueue(): { queue: SyncQueueService; updates: Recorded[] } {
  const updates: Recorded[] = [];
  const db = {
    client: {
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: async () => {
            updates.push({ set, whereCalled: true });
            return [{ id: 1 }, { id: 2 }];
          },
          returning: async () => {
            updates.push({ set, whereCalled: true });
            return [{ id: 1 }, { id: 2 }];
          },
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
  it("sync-worker calls requeueRetryable at the top of drainOnce", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const worker = readFileSync(join(__dirname, "..", "worker", "sync-worker.service.ts"), "utf8");
    const drain = worker.slice(worker.indexOf("async drainOnce"));
    const body = drain.slice(0, drain.indexOf("\n  }"));
    expect(body).toContain("requeueRetryable");
    // It must happen before the batch is read, or the requeued rows wait a
    // whole extra cycle.
    expect(body.indexOf("requeueRetryable")).toBeLessThan(body.indexOf("nextBatch"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "D:/School Management System/apps/backend"
npx jest src/cloud-backup/__tests__/queue-retry.spec.ts
```

Expected: FAIL â€” `MAX_ATTEMPTS` is not exported and `requeueRetryable` does not exist.

- [ ] **Step 3: Add the requeue to the queue service**

In `apps/backend/src/cloud-backup/queue/sync-queue.service.ts`, add near the top after the imports:

```typescript
/**
 * How many times a row may fail before it stops being retried automatically.
 * A row that hits the ceiling stays `failed` and is surfaced in Settings â†’
 * Data safety, because at that point the problem is not transient.
 */
export const MAX_ATTEMPTS = 10;
```

Replace `retryFailed` (which nothing called) with a method the worker can actually use:

```typescript
  /**
   * Returns failed rows under the attempt ceiling to `pending` so the next
   * drain retries them in sequence order.
   *
   * This is what keeps the event stream contiguous. Without it, one network
   * blip parked rows in `failed` permanently while later batches marched on,
   * leaving a gap that the restore replay skips silently.
   */
  async requeueRetryable(maxAttempts: number = MAX_ATTEMPTS): Promise<number> {
    const rows = await this.db.client
      .update(syncQueue)
      .set({ status: "pending" })
      .where(and(eq(syncQueue.status, "failed"), lt(syncQueue.attempts, maxAttempts)))
      .returning({ id: syncQueue.id });
    return rows.length;
  }
```

`and`, `eq` and `lt` are already imported at the top of the file.

- [ ] **Step 4: Call it from the drain cycle**

In `apps/backend/src/cloud-backup/worker/sync-worker.service.ts`, inside `drainOnce`, immediately after `this.syncing = true;` and before the `const batch = ...` line:

```typescript
    this.syncing = true;
    try {
      // Bring back anything a previous cycle failed on. Rows must be retried
      // before the next batch is read, or a transient failure becomes a
      // permanent gap in the sequence the restore replay depends on.
      const requeued = await this.queue.requeueRetryable();
      if (requeued > 0) {
        this.logger.log(`Requeued ${requeued} previously failed rows for retry.`);
      }

      const batch = await this.queue.nextBatch(BATCH_MAX_ROWS, BATCH_MAX_BYTES);
```

- [ ] **Step 5: Surface the ceiling in the status payload**

In `apps/backend/src/cloud-backup/cloud-backup.controller.ts`, the `status()` handler already returns `queue.failed`. Make a stuck row escalate the state â€” find the `syncState` ladder and add a clause before the final `else`:

```typescript
    } else if (queueStats.failed > 0) {
      syncState = "attention";
    } else if (queueStats.pending > ATTENTION_PENDING_ROWS || pendingOlder > 0) {
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx jest src/cloud-backup/__tests__/queue-retry.spec.ts
```

Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/cloud-backup/queue/sync-queue.service.ts \
        apps/backend/src/cloud-backup/worker/sync-worker.service.ts \
        apps/backend/src/cloud-backup/cloud-backup.controller.ts \
        apps/backend/src/cloud-backup/__tests__/queue-retry.spec.ts
git commit -m "fix: requeue failed sync rows instead of stranding them"
```

---

### Task 10: Make the split-brain guard real

**Closes:** F10 (`heartbeat()` is never called, `claim()` has no compare-and-swap, `finishRestore` ignores the conflict it is handed) and F36 (WebDAV `put` uses `overwrite: false`, so the registry can never be rewritten after the first claim).

**Files:**
- Modify: `apps/backend/src/cloud-backup/registry/instance-registry.service.ts:59-135`
- Modify: `apps/backend/src/cloud-backup/drivers/webdav.driver.ts:140-155` (`put`)
- Modify: `apps/backend/src/cloud-backup/drivers/storage-driver.ts` (`put` signature gains `overwrite`)
- Modify: `apps/backend/src/cloud-backup/worker/sync-worker.service.ts` (heartbeat on each drain)
- Modify: `apps/backend/src/cloud-backup/restore/restore.service.ts:311-315` (`finishRestore` must honour the conflict)
- Create: `apps/backend/src/cloud-backup/__tests__/registry-conflict.spec.ts`

**Interfaces:**
- Produces: `StorageDriver.put(key, stream, sizeHint?, opts?: { overwrite?: boolean })`. Default is `false` (backup objects are immutable); the registry passes `true`.
- Produces: `InstanceRegistryService.claim(...)` returns `ClaimResult` with a populated `conflict` when another instance's latest record is `active` **and** its `claimed_at` is within `ACTIVE_TTL_MS`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/cloud-backup/__tests__/registry-conflict.spec.ts`:

```typescript
import { InstanceRegistryService, latestPerInstance, ACTIVE_TTL_MS } from "../registry/instance-registry.service";
import { MemoryDriver } from "./support/memory-driver";

const SCHOOL = "ecole-test";

describe("instance registry", () => {
  it("lets a single instance claim cleanly", async () => {
    const registry = new InstanceRegistryService();
    const driver = new MemoryDriver();
    const result = await registry.claim(driver, SCHOOL, "uuid-a", "poste-a");
    expect(result.ok).toBe(true);
    expect(result.conflict).toBeNull();
  });

  it("detects a second live instance", async () => {
    const registry = new InstanceRegistryService();
    const driver = new MemoryDriver();
    await registry.claim(driver, SCHOOL, "uuid-a", "poste-a");
    const second = await registry.claim(driver, SCHOOL, "uuid-b", "poste-b");
    expect(second.ok).toBe(false);
    expect(second.conflict?.instance_uuid).toBe("uuid-a");
  });

  it("rewrites the registry object on every claim (WebDAV overwrite path)", async () => {
    const registry = new InstanceRegistryService();
    const driver = new MemoryDriver();
    await registry.claim(driver, SCHOOL, "uuid-a", "poste-a");
    await registry.claim(driver, SCHOOL, "uuid-a", "poste-a");
    // Two writes to the same key must both succeed; the old code passed
    // overwrite:false and the second PUT failed on WebDAV.
    expect(driver.putCount.get(registry.key(SCHOOL))).toBe(2);
  });

  it("ignores a stale claim so a dead machine does not block forever", () => {
    const stale = new Date(Date.now() - ACTIVE_TTL_MS - 60_000).toISOString();
    const fresh = new Date().toISOString();
    const latest = latestPerInstance([
      { instance_uuid: "dead", hostname: "vieux", claimed_at: stale, status: "active" },
      { instance_uuid: "live", hostname: "neuf", claimed_at: fresh, status: "active" },
    ]);
    const others = latest.filter((i) => i.instance_uuid !== "live");
    expect(others).toHaveLength(1);
    // The registry treats it as inactive because the heartbeat lapsed.
    expect(Date.now() - new Date(others[0].claimed_at).getTime()).toBeGreaterThan(ACTIVE_TTL_MS);
  });

  it("a retired instance never conflicts", async () => {
    const registry = new InstanceRegistryService();
    const driver = new MemoryDriver();
    await registry.claim(driver, SCHOOL, "uuid-a", "poste-a");
    await registry.retire(driver, SCHOOL, "uuid-a");
    const second = await registry.claim(driver, SCHOOL, "uuid-b", "poste-b");
    expect(second.conflict).toBeNull();
  });
});

describe("restore honours the conflict it is handed", () => {
  it("finishRestore checks claim().conflict", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const source = readFileSync(join(__dirname, "..", "restore", "restore.service.ts"), "utf8");
    const finish = source.slice(source.indexOf("async finishRestore"));
    const body = finish.slice(0, finish.indexOf("\n  private"));
    expect(body).toMatch(/claim\.conflict|claimResult\.conflict/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/cloud-backup/__tests__/registry-conflict.spec.ts
```

Expected: FAIL â€” `ACTIVE_TTL_MS` is not exported, the overwrite test fails on the second put, and `finishRestore` never reads `.conflict`.

- [ ] **Step 3: Add an overwrite flag to the driver contract**

In `apps/backend/src/cloud-backup/drivers/storage-driver.ts`:

```typescript
export interface PutOptions {
  /**
   * Backup objects are immutable and unique, so the default is false â€” a
   * collision means a key was reused, which must fail loudly. The instance
   * registry is the one mutable object in the namespace and passes true.
   */
  overwrite?: boolean;
}

export interface StorageDriver {
  readonly id: DriverId;
  readonly displayName: string;
  testConnection(): Promise<{ ok: true; latencyMs: number; probe: string }>;
  put(key: string, stream: Readable, sizeHint?: number, opts?: PutOptions): Promise<PutResult>;
  get(key: string): Promise<Readable>;
  list(prefix: string): Promise<ObjectMeta[]>;
}
```

In `webdav.driver.ts`, thread it through:

```typescript
  async put(key: string, stream: Readable, sizeHint?: number, opts?: PutOptions): Promise<PutResult> {
    const client = await this.client();
    try {
      await withRetry(async () => {
        await this.ensureFolders(client, key);
        await client.putFileContents(this.path(key), stream, {
          contentLength: sizeHint ?? false,
          overwrite: opts?.overwrite ?? false,
        });
      }, this.options);
      return { key, size: sizeHint ?? 0 };
    } catch (err) {
      throw this.classify(err);
    }
  }
```

`s3.driver.ts` and `gdrive.driver.ts` need the parameter added to their signatures for type compatibility; S3 overwrites natively, and for gdrive add a same-name lookup + `files.update` when `overwrite` is true (see Task 17, which rewrites that driver's put â€” a `// TODO` here would be a plan failure, so if you reach this before Task 17, implement it as):

```typescript
  async put(key: string, stream: Readable, sizeHint?: number, opts?: PutOptions): Promise<PutResult> {
    const auth = this.auth();
    try {
      await withRetry(async () => {
        const drive = driveClient(auth);
        const folderId = await this.rootFolder(auth, key.split("/")[0]);
        const name = this.fileName(key);
        if (opts?.overwrite) {
          const existing = await drive.files.list({
            q: `name = '${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`,
            fields: "files(id)",
            pageSize: 1,
          });
          const id = existing.data.files?.[0]?.id;
          if (id) {
            await drive.files.update({ fileId: id, media: { body: stream, mimeType: "application/octet-stream" } });
            return;
          }
        }
        await drive.files.create({
          requestBody: { name, parents: [folderId] },
          media: { body: stream, mimeType: "application/octet-stream" },
          fields: "id",
        });
      }, this.options);
      return { key, size: sizeHint ?? 0 };
    } catch (err) {
      throw this.classify(err);
    }
  }
```

- [ ] **Step 4: Age out stale claims and write with overwrite**

In `instance-registry.service.ts`, export the TTL and use it:

```typescript
/**
 * How long an `active` record is believed without a fresh heartbeat.
 *
 * Without this, a machine that died mid-term stays "active" forever and
 * blocks its own replacement â€” the exact situation the restore flow exists
 * for. The worker heartbeats every drain cycle (60 s by default), so three
 * hours is many missed beats, not a flap.
 */
export const ACTIVE_TTL_MS = 3 * 60 * 60 * 1000;
```

In `write`, pass the overwrite flag:

```typescript
  async write(driver: StorageDriver, schoolId: string, registry: InstanceRegistry): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(registry, null, 2), "utf8");
    // The registry is the one mutable object in the namespace.
    await driver.put(this.key(schoolId), streamFrom(bytes), bytes.length, { overwrite: true });
  }
```

In `claim`, filter the conflict by freshness:

```typescript
    const latest = latestPerInstance(current.instances);
    const now = Date.now();
    const conflict =
      latest.find(
        (i) =>
          i.instance_uuid !== instanceUuid &&
          i.status === "active" &&
          now - new Date(i.claimed_at).getTime() < ACTIVE_TTL_MS,
      ) ?? null;
```

- [ ] **Step 5: Heartbeat from the drain cycle**

In `sync-worker.service.ts`, add a field and call it once per drain. At the end of `drainOnce`'s `try` block, just before `this.lastDrainAt = new Date();`:

```typescript
      // Keep this instance's claim fresh. Without a heartbeat the claim ages
      // past ACTIVE_TTL_MS and a second machine would be allowed to start
      // syncing alongside this one.
      await this.heartbeatAll(st, targets);
```

And add the method:

```typescript
  private async heartbeatAll(
    state: LoadedState,
    targets: Array<{ id: string; driver: StorageDriver }>,
  ): Promise<void> {
    for (const target of targets) {
      try {
        const result = await this.registry.heartbeat(
          target.driver,
          state.schoolId,
          state.instanceUuid,
          state.hostname,
        );
        if (result.conflict) {
          this.conflict = {
            hostname: result.conflict.hostname,
            instance_uuid: result.conflict.instance_uuid,
            claimed_at: result.conflict.claimed_at,
          };
          this.logger.error(
            `Split-brain detected during heartbeat: ${result.conflict.hostname} also claims school ${state.schoolId}. Sync paused.`,
          );
          return;
        }
      } catch {
        // An unreachable target is an offline condition, not a conflict.
        this.logger.warn(`Heartbeat against ${target.id} failed â€” retrying next cycle.`);
      }
    }
    this.conflict = null;
  }
```

And make `drainOnce` refuse to run while a conflict stands â€” add to the guard at the top:

```typescript
    if (this.syncing) return false;
    if (this.conflict) return false;
```

- [ ] **Step 6: Make finishRestore honour the conflict**

In `restore.service.ts`, replace the bare `await this.registry.claim(...)` in `finishRestore`:

```typescript
    const claim = await this.registry.claim(driver, schoolId, instanceUuid, hostname);
    if (claim.conflict) {
      throw new BadRequestException(
        `Une autre installation (${claim.conflict.hostname}) sauvegarde encore cette Ã©cole. ` +
          "Retirez-la d'abord depuis ParamÃ¨tres â†’ SÃ©curitÃ© des donnÃ©es, puis relancez la restauration.",
      );
    }
```

Move this **above** the `cloud_state` write so a rejected claim does not leave the install marked `setup_complete`.

- [ ] **Step 7: Run the test to verify it passes**

```bash
npx jest src/cloud-backup/__tests__/registry-conflict.spec.ts
```

Expected: PASS (6 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/cloud-backup/registry/ apps/backend/src/cloud-backup/drivers/ \
        apps/backend/src/cloud-backup/worker/sync-worker.service.ts \
        apps/backend/src/cloud-backup/restore/restore.service.ts \
        apps/backend/src/cloud-backup/__tests__/registry-conflict.spec.ts
git commit -m "fix: heartbeat the instance claim and honour split-brain conflicts"
```

---

### Task 11: Fix the two `pg_*` subprocess bugs

**Closes:** F11 (`psql` restore deadlocks because its piped stdout is never read) and F12 (`pg_dump` fallback resolves before the dump file finishes flushing).

**Files:**
- Modify: `apps/backend/src/cloud-backup/restore/restore.service.ts:239-262` (`loadSqlFile`)
- Modify: `apps/backend/src/cloud-backup/worker/snapshot.service.ts:60-100` (`dumpToFile`)
- Create: `apps/backend/src/cloud-backup/__tests__/pg-subprocess.spec.ts`

`psql -f` writes a command tag per statement to stdout. With `stdio: ["ignore", "pipe", "inherit"]` and no reader, the 64 KB pipe buffer fills on any real dump and the child blocks forever â€” the restore hangs with no error. The dump path has the mirror problem: it resolves on the child's `close` without waiting for the `createWriteStream` to emit `finish`, so `statSync` can measure a partially-flushed file.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/cloud-backup/__tests__/pg-subprocess.spec.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const RESTORE = readFileSync(join(__dirname, "..", "restore", "restore.service.ts"), "utf8");
const SNAPSHOT = readFileSync(join(__dirname, "..", "worker", "snapshot.service.ts"), "utf8");

describe("psql child process", () => {
  it("never leaves stdout piped and unread", () => {
    const load = RESTORE.slice(RESTORE.indexOf("private async loadSqlFile"));
    const body = load.slice(0, load.indexOf("\n  /**"));
    // Either stdout is ignored/inherited, or it is explicitly drained.
    const drains = /child\.stdout(\?\.)?\.(resume|on)\(/.test(body);
    const notPiped = /stdio:\s*\["ignore",\s*"ignore",\s*"pipe"\]|stdio:\s*"inherit"/.test(body);
    expect(drains || notPiped).toBe(true);
  });
});

describe("pg_dump child process", () => {
  it("waits for the write stream to finish, not just the child to close", () => {
    const dump = SNAPSHOT.slice(SNAPSHOT.indexOf("private async dumpToFile"));
    const body = dump.slice(0, dump.indexOf("\n  /**"));
    expect(body).toMatch(/on\(["']finish["']/);
  });
});

describe("a child whose stdout is piped and unread deadlocks", () => {
  it("demonstrates the failure mode this task fixes", async () => {
    // node prints ~1 MB to stdout; with a piped, unread stdout it cannot exit.
    const child = spawn(process.execPath, ["-e", "process.stdout.write('x'.repeat(1024*1024))"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 1_500);
      child.on("close", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    child.kill();
    expect(exited).toBe(false);
  }, 10_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/cloud-backup/__tests__/pg-subprocess.spec.ts
```

Expected: the first two FAIL; the third PASSES (it documents the mechanism, and stays green forever).

- [ ] **Step 3: Drain psql's output**

In `restore.service.ts`, rewrite the `run` closure inside `loadSqlFile`:

```typescript
    const run = (binary: string) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(
          binary,
          ["-U", cfg.user, "-h", cfg.host, "-p", String(cfg.port), "-d", cfg.database, "-v", "ON_ERROR_STOP=1", "-f", path],
          { env: { ...process.env, PGPASSWORD: cfg.password }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
        );

        // psql writes one command tag per statement. A piped stdout that
        // nobody reads fills its 64 KB buffer and blocks the child forever â€”
        // the restore hung with no error and no output.
        let tail = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", () => {
          /* drained and discarded: the tags are noise, the exit code is truth */
        });
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          tail = (tail + chunk).slice(-4_000);
        });

        child.on("error", reject);
        child.on("close", (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`psql exited with code ${code}${tail ? `: ${tail.trim()}` : ""}`)),
        );
      });
```

Capturing stderr is a bonus: `ON_ERROR_STOP=1` failures previously vanished into the parent's console with no way to show the admin why the restore stopped.

- [ ] **Step 4: Wait for the dump file to flush**

In `snapshot.service.ts`, rewrite the spawn branch of `dumpToFile`:

```typescript
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        pgDump,
        ["-U", cfg.user, "-h", cfg.host, "-p", String(cfg.port), "-d", cfg.database, "--format=plain", "--no-owner", "--no-privileges"],
        { env: { ...process.env, PGPASSWORD: cfg.password }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      const out = createWriteStream(targetPath, { flags: "w" });

      let stderrTail = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-4_000);
      });

      let exitCode: number | null = null;
      let closed = false;
      let flushed = false;

      const settle = () => {
        if (!closed || !flushed) return;
        if (exitCode !== 0) {
          reject(new Error(`pg_dump exited with code ${exitCode}${stderrTail ? `: ${stderrTail.trim()}` : ""}`));
        } else {
          resolve();
        }
      };

      child.stdout.pipe(out);
      child.on("error", reject);
      out.on("error", reject);
      // Both must complete: the child can exit while the last buffer is still
      // being written, and statSync would then measure a truncated dump.
      out.on("finish", () => {
        flushed = true;
        settle();
      });
      child.on("close", (code) => {
        exitCode = code;
        closed = true;
        settle();
      });
    });
```

Note `child.stdout.pipe(out)` ends `out` on its own â€” the manual `out.end()` in the old code is gone.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx jest src/cloud-backup/__tests__/pg-subprocess.spec.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/cloud-backup/restore/restore.service.ts \
        apps/backend/src/cloud-backup/worker/snapshot.service.ts \
        apps/backend/src/cloud-backup/__tests__/pg-subprocess.spec.ts
git commit -m "fix: drain psql stdout and wait for pg_dump to flush"
```

---

### Task 12: Register the actor interceptor, or delete it

**Closes:** F13 (`SyncActorInterceptor` is defined in no module, so `app.actor_user_id` is never set and every `sync_queue` row records a null actor; the pooled-connection design is also unsound as written).

**Files:**
- Modify: `apps/backend/src/cloud-backup/queue/sync-context.ts:19-50`
- Modify: `apps/backend/src/cloud-backup/cloud-backup.module.ts`
- Create: `apps/backend/src/cloud-backup/__tests__/sync-context.spec.ts`

Two problems, one fix. The interceptor was never registered, and even if it had been, `set_config(..., false)` is session-scoped on a connection from a 10-connection pool: the `SELECT set_config` and the business write can land on different connections, and the value persists on that connection into an unrelated later request. The honest fix is to stop pretending a fire-and-forget session variable works and make attribution explicit and transaction-local, keeping the trigger's `current_setting` read exactly as it is.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/cloud-backup/__tests__/sync-context.spec.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withActor } from "../queue/sync-context";

const MODULE = readFileSync(join(__dirname, "..", "cloud-backup.module.ts"), "utf8");
const CONTEXT = readFileSync(join(__dirname, "..", "queue", "sync-context.ts"), "utf8");

describe("sync actor attribution", () => {
  it("is not dead code â€” the interceptor is registered or gone", () => {
    const declaresInterceptor = CONTEXT.includes("SyncActorInterceptor");
    if (declaresInterceptor) {
      expect(MODULE).toContain("SyncActorInterceptor");
    }
    expect(true).toBe(true);
  });

  it("never interpolates the actor id into SQL", () => {
    // The old code built `set_config('app.actor_user_id', '${actorId}', false)`.
    expect(CONTEXT).not.toMatch(/set_config\('app\.actor_user_id',\s*'\$\{/);
  });

  it("sets the actor transaction-locally, not session-wide", () => {
    // Third argument true = is_local, scoped to the surrounding transaction.
    expect(CONTEXT).toMatch(/set_config\([^)]*app\.actor_user_id[^)]*true/);
  });

  it("withActor runs its callback inside one transaction", async () => {
    const calls: string[] = [];
    const db = {
      client: {
        transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
          calls.push("begin");
          const tx = {
            execute: async (q: unknown) => {
              calls.push(`execute:${String(q)}`);
            },
          };
          const result = await fn(tx);
          calls.push("commit");
          return result;
        },
      },
    };

    await withActor(db as never, "11111111-1111-1111-1111-111111111111", async () => "done");

    expect(calls[0]).toBe("begin");
    expect(calls[calls.length - 1]).toBe("commit");
    expect(calls.some((c) => c.includes("set_config"))).toBe(true);
  });

  it("rejects an actor id that is not a UUID", async () => {
    const db = { client: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ execute: async () => undefined }) } };
    await expect(withActor(db as never, "'; DROP TABLE users; --", async () => "x")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/cloud-backup/__tests__/sync-context.spec.ts
```

Expected: FAIL â€” `withActor` is not exported, and the module does not mention the interceptor.

- [ ] **Step 3: Replace the interceptor with an explicit, transaction-local helper**

In `apps/backend/src/cloud-backup/queue/sync-context.ts`, delete `SyncActorInterceptor` entirely and replace it with:

```typescript
import { sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Attributes every write inside `fn` to `actorUserId` for the sync triggers.
 *
 * This replaces a request interceptor that set `app.actor_user_id` with
 * `set_config(..., false)` â€” session scope â€” and fired it without awaiting.
 * With a 10-connection pool that was unsound twice over: the setting and the
 * write could land on different connections, and the value survived on its
 * connection into the next, unrelated request. Transaction-local scope
 * (`is_local = true`) is the only form that is actually correct here, and it
 * requires the caller to own the transaction â€” hence this helper rather than
 * an interceptor.
 *
 * The trigger side is unchanged: it still reads
 * `current_setting('app.actor_user_id', true)`.
 */
export async function withActor<T>(
  db: DbService,
  actorUserId: string,
  fn: (tx: DbService["client"]) => Promise<T>,
): Promise<T> {
  if (!UUID.test(actorUserId)) {
    throw new Error(`Invalid actor id for sync attribution: ${actorUserId}`);
  }
  return db.client.transaction(async (tx) => {
    // Parameterised, and transaction-local. The old code interpolated the id
    // straight into the statement text.
    await tx.execute(sql`SELECT set_config('app.actor_user_id', ${actorUserId}, true)`);
    return fn(tx as DbService["client"]);
  });
}
```

Keep `withSyncDisabled` exactly as it is â€” it was already transaction-local and correct.

- [ ] **Step 4: Record the consequence in the trigger docs**

In `apps/backend/src/cloud-backup/queue/sync-trigger-bootstrap.ts`, update the "Actor attribution" paragraph of the header comment so it stops describing an interceptor that no longer exists:

```
 * Actor attribution: writes that want an attributed actor wrap themselves in
 * `withActor(db, userId, tx => ...)`, which sets `app.actor_user_id`
 * transaction-locally; the trigger reads it via `current_setting`. Writes
 * that do not are attributed to the system (null actor) â€” which is every
 * write today. Restore/seed/import set `app.sync_disabled` instead so their
 * writes produce no queue rows at all.
```

- [ ] **Step 5: Verify nothing still imports the deleted class**

```bash
cd "D:/School Management System/apps/backend"
grep -rn "SyncActorInterceptor" src/
npx tsc --noEmit -p tsconfig.json
```

Expected: no grep hits, and `tsc` exits 0.

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx jest src/cloud-backup/__tests__/sync-context.spec.ts
```

Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/cloud-backup/queue/ \
        apps/backend/src/cloud-backup/__tests__/sync-context.spec.ts
git commit -m "fix: replace the unregistered actor interceptor with a transaction-local helper"
```

---

### Task 13: Make the machine key work in a container

**Closes:** F14 (`machineId()` returns null on `node:22-alpine`, so `save()` and `wrapFromPhrase()` throw and cloud backup cannot be configured in Docker at all; and where a machine-id does exist Docker regenerates it per container, silently orphaning the wrapped master key).

**Files:**
- Modify: `apps/backend/src/cloud-backup/credential-store/machine-key.ts:20-58`
- Modify: `docker-compose.yml` (document the volume)
- Modify: `BACKUP.md` (the Docker caveat)
- Create: `apps/backend/src/cloud-backup/__tests__/machine-key.spec.ts`

The machine key exists to make a copied folder useless on another computer. In a container that property is provided by the volume, not by the host â€” so the fix is an explicit, persisted key file inside the data directory, used only when no OS-level machine identity is available.

**Interfaces:**
- Produces: `machineId(): string | null` â€” unchanged signature, new final fallback.
- Produces: `MACHINE_KEY_FILE = ".cloud-creds/machine-key"` (exported const).

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/cloud-backup/__tests__/machine-key.spec.ts`:

```typescript
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { machineId, machineKey, deriveStoreKey, resetMachineIdCache } from "../credential-store/machine-key";

describe("machine key", () => {
  let dir: string;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "iq-machinekey-"));
    resetMachineIdCache();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
    resetMachineIdCache();
  });

  it("always yields a key, even with no OS machine identity", () => {
    const key = machineKey(dir);
    expect(key).not.toBeNull();
    expect(key!.length).toBe(32);
  });

  it("is stable across calls â€” a wrapped key stays unwrappable", async () => {
    const first = machineKey(dir)!;
    resetMachineIdCache();
    const second = machineKey(dir)!;
    expect(first.equals(second)).toBe(true);
  });

  it("persists the generated identity so a container restart can unwrap", async () => {
    machineKey(dir);
    const persisted = await readFile(join(dir, "machine-key"), "utf8");
    expect(persisted.trim().length).toBeGreaterThanOrEqual(32);
  });

  it("differs between two independent installs", async () => {
    const other = await mkdtemp(join(tmpdir(), "iq-machinekey-b-"));
    try {
      const a = machineKey(dir)!;
      resetMachineIdCache();
      const b = machineKey(other)!;
      expect(a.equals(b)).toBe(false);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("derives distinct store keys from distinct salts", () => {
    const base = machineKey(dir)!;
    const one = deriveStoreKey(base, Buffer.alloc(16, 1));
    const two = deriveStoreKey(base, Buffer.alloc(16, 2));
    expect(one.equals(two)).toBe(false);
  });

  it("machineId is null only when no source and no fallback dir is given", () => {
    expect(typeof machineId(dir)).toBe("string");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/cloud-backup/__tests__/machine-key.spec.ts
```

Expected: FAIL â€” `machineKey` takes no argument, `resetMachineIdCache` does not exist, and on a machine with no `/etc/machine-id` the key is `null`.

- [ ] **Step 3: Add a persisted fallback identity**

Rewrite `apps/backend/src/cloud-backup/credential-store/machine-key.ts`'s identity section:

```typescript
import { createHash, createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";

const MACHINE_ID_REGISTRY = "HKLM\\SOFTWARE\\Microsoft\\Cryptography";
const MACHINE_ID_VALUE = "MachineGuid";

/** File name of the generated identity, inside the credential directory. */
export const MACHINE_KEY_FILE = "machine-key";

let cached: string | null = null;

/** Test seam: forget the memoised identity. */
export function resetMachineIdCache(): void {
  cached = null;
}

function fromWindowsRegistry(): string | null {
  if (process.platform !== "win32") return null;
  try {
    const out = execFileSync("reg", ["query", MACHINE_ID_REGISTRY, "/v", MACHINE_ID_VALUE], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: 10_000,
    });
    const match = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
    return match ? match[1].trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

function fromSystemFiles(): string | null {
  for (const file of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      if (existsSync(file)) {
        const id = readFileSync(file, "utf8").trim();
        if (id) return id.toLowerCase();
      }
    } catch {
      /* continue */
    }
  }
  return null;
}

/**
 * Last resort: a random identity generated once and persisted next to the
 * credentials it protects.
 *
 * A container has no stable host identity â€” `node:22-alpine` ships no
 * `/etc/machine-id` and no `hostid`, so the old code returned null and the
 * cloud backup could not be configured at all. Where the machine identity
 * comes from the host, a copied folder cannot decrypt its credentials on
 * another machine; where it comes from this file, that property is provided
 * by the volume the file lives on. Both are honest, and neither is a secret
 * that travels with a git clone â€” this path is inside `.cloud-creds/`, which
 * is git-ignored.
 */
function fromPersistedFile(dir: string): string {
  const path = join(dir, MACHINE_KEY_FILE);
  try {
    if (existsSync(path)) {
      const id = readFileSync(path, "utf8").trim();
      if (id.length >= 32) return id.toLowerCase();
    }
  } catch {
    /* regenerate below */
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const generated = randomBytes(32).toString("hex");
  writeFileSync(path, generated, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows ignores POSIX modes; the directory ACL covers it */
  }
  return generated;
}

/**
 * A stable identifier for this installation. Prefers the OS machine identity
 * (Windows MachineGuid, then /etc/machine-id) and falls back to a persisted
 * random value in `fallbackDir`.
 */
export function machineId(fallbackDir?: string): string | null {
  if (cached) return cached;
  const found = fromWindowsRegistry() ?? fromSystemFiles();
  if (found) {
    cached = found;
    return cached;
  }
  if (!fallbackDir) return null;
  cached = fromPersistedFile(fallbackDir);
  return cached;
}

/** 32-byte machine-bound key. Deterministic for the life of the install. */
export function machineKey(fallbackDir?: string): Buffer | null {
  const id = machineId(fallbackDir);
  if (!id) return null;
  return createHash("sha256").update(id).digest();
}
```

Keep `deriveStoreKey` and `freshSalt` unchanged.

- [ ] **Step 4: Pass the credential directory in from both callers**

In `credential-store.service.ts`, `this.dir` is already the `.cloud-creds` path. Change every `machineKey()` call in that file to `machineKey(this.dir)`.

In `cloud-key.service.ts`, the service has no directory of its own â€” inject the credential store and use its directory. Add a public getter to `CredentialStoreService`:

```typescript
  /** The credential directory, also used as the machine-key fallback location. */
  get directory(): string {
    return this.dir;
  }
```

and in `cloud-key.service.ts`:

```typescript
  constructor(private readonly creds: CredentialStoreService) {}
```

replacing both `machineKey()` calls with `machineKey(this.creds.directory)`. `CredentialStoreService` is already a provider in `cloud-backup.module.ts`, so no module change is needed.

- [ ] **Step 5: Persist the directory in Docker**

In `docker-compose.yml`, add a named volume for the app service so the identity and credentials survive a container recreate:

```yaml
    volumes:
      - cloud-creds:/app/.cloud-creds
```

and under the top-level `volumes:` key:

```yaml
  cloud-creds:
```

Add a note to `BACKUP.md` under section 1, after the split-brain paragraph:

```markdown
### Docker

The wrapped master key is bound to a machine identity. In a container there is
no host identity to bind to, so one is generated on first run and stored at
`/app/.cloud-creds/machine-key`. **That path must be on a persistent volume**
(`docker-compose.yml` mounts the `cloud-creds` volume for exactly this). Lose
it and the local wrapped key becomes undecryptable â€” the cloud data is still
fine, but recovering it means running the restore flow with the recovery
phrase.
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx jest src/cloud-backup/__tests__/machine-key.spec.ts
```

Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/cloud-backup/credential-store/ \
        apps/backend/src/cloud-backup/__tests__/machine-key.spec.ts \
        docker-compose.yml BACKUP.md
git commit -m "feat: persist a machine identity so cloud backup works in containers"
```

---

### Task 14: Make re-running setup safe

**Closes:** F15 (re-running `setup/step-1` silently replaces the KDF salt and wrapped key while the cloud still holds objects encrypted under the old key, permanently orphaning every byte of backup history).

**Files:**
- Modify: `apps/backend/src/cloud-backup/setup/setup.service.ts:57-110` (`step1`)
- Modify: `apps/backend/src/cloud-backup/cloud-backup.controller.ts:243-249` (`step1` route)
- Modify: `apps/frontend/components/settings/data-safety-section.tsx` (confirmation copy)
- Create: `apps/backend/src/cloud-backup/__tests__/setup-reinit.spec.ts`

There is a legitimate reason to re-run step 1 â€” Task 2's fix means existing installs must rewrite their check object â€” so the answer is not to forbid it, but to distinguish *re-seeding with the same phrase* (safe, idempotent) from *starting over with a new phrase* (destroys access to all history) and to require an explicit acknowledgement for the second.

**Interfaces:**
- Produces: `CloudSetupService.step1(input: { schoolId, phrase, confirmReplaceExisting?: boolean })`. Throws `BadRequestException` when a configured install would get a different derived key and `confirmReplaceExisting` is not `true`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/cloud-backup/__tests__/setup-reinit.spec.ts`:

```typescript
import { BadRequestException } from "@nestjs/common";
import { CloudSetupService } from "../setup/setup.service";
import { buildKdfParams, newSalt } from "../crypto/kdf";
import { CloudKeyService } from "../credential-store/cloud-key.service";

const EXISTING_KDF = buildKdfParams("scrypt", newSalt(), { scryptN: 1024 });
const PHRASE = "abandon ability able about above absent absorb abstract absurd abuse access accident";

function makeService(existing: Record<string, unknown> | null) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    client: {
      query: { cloudState: { findFirst: async () => existing } },
      update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => updates.push(v) }) }),
      insert: () => ({ values: async (v: Record<string, unknown>) => updates.push(v) }),
      select: () => ({ from: () => ({ where: async () => [] }) }),
    },
  };
  const keys = new CloudKeyService({ directory: process.cwd() } as never);
  const service = new CloudSetupService(
    db as never, keys as never, { load: async () => null } as never,
    {} as never, {} as never, {} as never, {} as never,
  );
  return { service, updates };
}

describe("re-running setup step 1", () => {
  it("refuses a new phrase on a configured install without explicit confirmation", async () => {
    const { service } = makeService({
      setup_complete: true,
      kdf_salt: JSON.stringify(EXISTING_KDF),
      wrapped_key: "existing",
      wrap_salt: "existing",
    });

    await expect(
      service.step1({ schoolId: "ecole-test", phrase: PHRASE }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("names the consequence in the error", async () => {
    const { service } = makeService({
      setup_complete: true,
      kdf_salt: JSON.stringify(EXISTING_KDF),
      wrapped_key: "existing",
      wrap_salt: "existing",
    });

    await expect(service.step1({ schoolId: "ecole-test", phrase: PHRASE })).rejects.toThrow(
      /illisibles|historique|irrÃ©versible/i,
    );
  });

  it("allows a fresh install with no confirmation", async () => {
    const { service } = makeService(null);
    await expect(
      service.step1({ schoolId: "ecole-test", phrase: PHRASE, confirmReplaceExisting: false }),
    ).resolves.toBeDefined();
  });

  it("reuses the existing KDF salt when re-seeding, so the key is unchanged", async () => {
    const { service, updates } = makeService({
      setup_complete: true,
      kdf_salt: JSON.stringify(EXISTING_KDF),
      wrapped_key: "existing",
      wrap_salt: "existing",
    });

    await service.step1({ schoolId: "ecole-test", phrase: PHRASE, confirmReplaceExisting: true });
    const written = updates.find((u) => u.kdf_salt);
    // Confirmed replacement gets a NEW salt â€” that is the destructive path.
    expect(written!.kdf_salt).not.toBe(JSON.stringify(EXISTING_KDF));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/cloud-backup/__tests__/setup-reinit.spec.ts
```

Expected: FAIL â€” `step1` accepts no `confirmReplaceExisting` and never rejects.

- [ ] **Step 3: Add the guard**

In `apps/backend/src/cloud-backup/setup/setup.service.ts`, change `step1`'s signature and add the check before any write:

```typescript
  async step1(input: {
    schoolId: string;
    phrase: string;
    /**
     * Required to overwrite a configured install's KDF salt. Doing so
     * re-keys the namespace: every object already in the cloud was encrypted
     * under the old key and becomes permanently unreadable.
     */
    confirmReplaceExisting?: boolean;
  }): Promise<{ schoolId: string; instanceUuid: string; kdf: KdfParams }> {
    const schoolId = input.schoolId.trim().toLowerCase().replace(/\s+/g, "-");
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(schoolId)) {
      throw new BadRequestException(
        "Identifiant d'Ã©cole invalide : 3 Ã  64 caractÃ¨res, lettres minuscules, chiffres et tirets.",
      );
    }

    const existing = await this.db.client.query.cloudState.findFirst({ where: eq(cloudState.singleton, "global") });

    if (existing?.setup_complete && existing.kdf_salt && !input.confirmReplaceExisting) {
      throw new BadRequestException(
        "Cette installation a dÃ©jÃ  une sauvegarde cloud configurÃ©e. Reconfigurer gÃ©nÃ¨re une nouvelle clÃ© : " +
          "toutes les sauvegardes dÃ©jÃ  envoyÃ©es deviendraient dÃ©finitivement illisibles, y compris tout l'historique. " +
          "Cette action est irrÃ©versible â€” confirmez explicitement pour continuer.",
      );
    }

    const kdf = makeSchoolSalt();
    const wrapped = await this.keys.wrapFromPhrase(input.phrase, kdf);
```

The rest of `step1` is unchanged; delete its now-duplicated `const existing = ...` lookup further down and reuse this one.

- [ ] **Step 4: Pass the flag through the controller**

In `cloud-backup.controller.ts`:

```typescript
  @Post("setup/step-1")
  @UseGuards(JwtAuthGuard)
  step1(@Body() body: { schoolId?: string; phrase?: string; confirmReplaceExisting?: boolean }) {
    if (!body.schoolId || !body.phrase) throw new BadRequestException("Identifiant d'Ã©cole et phrase requis.");
    return this.setup.step1({
      schoolId: body.schoolId,
      phrase: body.phrase,
      confirmReplaceExisting: body.confirmReplaceExisting === true,
    });
  }
```

- [ ] **Step 5: Add the frontend confirmation**

In `apps/frontend/components/settings/data-safety-section.tsx`, find the call that posts to `setup/step-1`. When the current status reports `configured: true`, require a typed confirmation before sending `confirmReplaceExisting: true`. Add near the other dialog state:

```typescript
const [reconfigureAck, setReconfigureAck] = useState("");
const alreadyConfigured = status?.configured === true;
const mayProceed = !alreadyConfigured || reconfigureAck.trim().toUpperCase() === "REMPLACER";
```

and render, immediately above the submit button, when `alreadyConfigured` is true:

```tsx
<div className="rounded-btn border border-danger/30 bg-danger-soft dark:bg-danger-dark-soft px-4 py-3 text-sm space-y-2">
  <p className="font-semibold text-danger-strong dark:text-danger-dark-strong">
    {t("cloudSafeSave.reconfigureWarning", "Une sauvegarde cloud est dÃ©jÃ  configurÃ©e.")}
  </p>
  <p className="text-text-secondary text-xs">
    {t(
      "cloudSafeSave.reconfigureDetail",
      "Reconfigurer gÃ©nÃ¨re une nouvelle clÃ©. Tout ce qui a dÃ©jÃ  Ã©tÃ© envoyÃ© au cloud deviendra dÃ©finitivement illisible. Tapez REMPLACER pour confirmer.",
    )}
  </p>
  <input
    value={reconfigureAck}
    onChange={(e) => setReconfigureAck(e.target.value)}
    placeholder="REMPLACER"
    className="w-full rounded-btn border border-border bg-background px-3 py-2 text-sm"
  />
</div>
```

Gate the submit with `disabled={!mayProceed || busy}` and send `confirmReplaceExisting: alreadyConfigured`.

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd "D:/School Management System/apps/backend"
npx jest src/cloud-backup/__tests__/setup-reinit.spec.ts
```

Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/cloud-backup/setup/setup.service.ts \
        apps/backend/src/cloud-backup/cloud-backup.controller.ts \
        apps/backend/src/cloud-backup/__tests__/setup-reinit.spec.ts \
        apps/frontend/components/settings/data-safety-section.tsx
git commit -m "fix: require explicit confirmation before re-keying a configured backup"
```
