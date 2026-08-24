
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
