import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { hostname as osHostname } from "node:os";
import { eq, sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { backupManifest, cloudState, cloudTargets } from "../../db/schema";
import type { StorageDriver } from "../drivers/storage-driver";
import { createDriver } from "../drivers/driver-registry";
import { SyncQueueService } from "../queue/sync-queue.service";
import { encodeObject } from "../crypto/object-codec";
import { compressionAlgorithm } from "../crypto/compression";
import { CloudKeyService } from "../credential-store/cloud-key.service";
import { CredentialStoreService } from "../credential-store/credential-store.service";
import { InstanceRegistryService } from "../registry/instance-registry.service";
import { SnapshotService } from "./snapshot.service";
import { checkObjectIsCurrent, writeMetaObjects } from "../setup/meta-objects";
import { RedactingLogger } from "../redaction/redaction";
import { Readable } from "node:stream";

export const DRAIN_MIN_INTERVAL_MS = 30_000;
export const DRAIN_MAX_INTERVAL_MS = 300_000;
export const BATCH_MAX_ROWS = 500;
export const BATCH_MAX_BYTES = 4 * 1024 * 1024;
export const ATTENTION_PENDING_ROWS = 5_000;
export const ATTENTION_OLDEST_MS = 72 * 3600 * 1000;

export type SyncState = "synced" | "offline" | "syncing" | "attention" | "disabled";

interface LoadedState {
  schoolId: string;
  key: Buffer;
  kdf: Parameters<typeof encodeObject>[0]["kdf"];
  instanceUuid: string;
  hostname: string;
  quietHour: number;
  drainIntervalMs: number;
}

/**
 * Background sync worker — the heart of the continuous-mirror guarantee.
 *
 * - Drains the durable queue every N seconds (30–300, default 60) in
 *   sequence order, oldest first, batching events and streaming them through
 *   serialize → compress (zstd) → encrypt (AES-256-GCM) → upload.
 * - Fans every artifact out to ALL enabled targets; a failing target never
 *   blocks the others, and a row is marked sent once it reached at least one.
 * - Runs a full snapshot at the configured quiet hour, on demand, and at boot
 *   when the schema hash changed (migration detected).
 * - Is never, ever allowed to block or error the request path: it runs on its
 *   own timers, swallows connectivity failures, and leaves the queue durable
 *   on disk to drain on reconnect.
 */
@Injectable()
export class SyncWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new RedactingLogger(SyncWorkerService.name);
  private drainTimer: NodeJS.Timeout | null = null;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private readonly instanceHostname = osHostname() || "unknown-host";

  private syncing = false;
  private lastDrainAt: Date | null = null;
  private conflict: { hostname: string; instance_uuid: string; claimed_at: string } | null = null;

  isSyncing(): boolean {
    return this.syncing;
  }

  lastDrainAtTime(): Date | null {
    return this.lastDrainAt;
  }

  currentConflict(): { hostname: string; instance_uuid: string; claimed_at: string } | null {
    return this.conflict;
  }

  /** Forces an immediate drain cycle (setup verification). */
  async runDrainNow(): Promise<boolean> {
    return this.drainOnce();
  }

  constructor(
    private readonly db: DbService,
    private readonly queue: SyncQueueService,
    private readonly keys: CloudKeyService,
    private readonly creds: CredentialStoreService,
    private readonly registry: InstanceRegistryService,
    private readonly snapshots: SnapshotService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const state = await this.loadState();
      if (!state) {
        this.logger.log("Cloud backup not configured — worker idle.");
        return;
      }
      this.keys.setRuntimeKey(state.key);
      this.currentState = state;

      // Split-brain protection: refuse to sync if another active instance holds
      // this school's namespace. The conflict is surfaced through the status
      // API; the worker stays idle until a human resolves it.
      const claim = await this.claimAll(state);
      if (claim.conflict) {
        this.conflict = {
          hostname: claim.conflict.hostname,
          instance_uuid: claim.conflict.instance_uuid,
          claimed_at: claim.conflict.claimed_at,
        };
        this.logger.error(
          `Split-brain guard: another active instance (${claim.conflict.hostname}) holds school ${state.schoolId}. Sync disabled until resolved.`,
        );
        return;
      }
      this.conflict = null;

      // Self-heal the namespace's meta objects.
      //
      // The check object gained a `school_id` field, so an install seeded by
      // an older build carries one that would reject a perfectly valid
      // recovery phrase — the restore would fail at the only moment it
      // matters. Rewriting it needs the master key, which this worker has
      // just unwrapped, so it costs one small download per target at boot and
      // spares the administrator a migration they would never know to run.
      await this.ensureMetaObjects(state);

      // Migration detection: a changed schema means the snapshot is out of date
      // with the schema the backups describe — take one immediately.
      const hash = await this.snapshots.schemaHash();
      const row = await this.db.client.query.cloudState.findFirst({ where: eq(cloudState.singleton, "global") });
      if (row && row.schema_hash && row.schema_hash !== hash) {
        this.logger.log("Schema changed since last snapshot — taking an immediate snapshot.");
        await this.snapshots.runSnapshot(await this.enabledTargets(), state.key, state.schoolId, state.kdf, "migration");
        await this.db.client
          .update(cloudState)
          .set({ schema_hash: hash })
          .where(eq(cloudState.singleton, "global"));
      }

      this.scheduleDrain(state);
      this.scheduleSnapshot(state);
      this.logger.log(`Sync worker active: draining every ${this.drainIntervalMs()} ms.`);
    } catch (err) {
      this.logger.error(`Sync worker failed to start: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.drainTimer) clearTimeout(this.drainTimer);
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    for (const entry of this.driverCache.values()) this.disposeDriver(entry.driver);
    this.driverCache.clear();
  }

  private async loadState(): Promise<LoadedState | null> {
    const row = await this.db.client.query.cloudState.findFirst({ where: eq(cloudState.singleton, "global") });
    if (!row?.school_id || !row.kdf_salt || !row.wrapped_key || !row.wrap_salt) return null;
    const kdf = JSON.parse(row.kdf_salt) as LoadedState["kdf"];
    const key = await this.keys.unwrap(row.wrapped_key, row.wrap_salt);
    const rawInterval = Number(row.drain_interval_seconds ?? 60);
    const intervalMs = Number.isFinite(rawInterval)
      ? Math.min(DRAIN_MAX_INTERVAL_MS, Math.max(DRAIN_MIN_INTERVAL_MS, rawInterval * 1000))
      : 60_000;
    return {
      schoolId: row.school_id,
      key,
      kdf,
      instanceUuid: row.instance_uuid,
      hostname: this.instanceHostname,
      quietHour: Number.isFinite(Number(row.quiet_hour)) ? Number(row.quiet_hour) : 3,
      drainIntervalMs: intervalMs,
    };
  }

  private drainIntervalMs(): number {
    return this.currentState?.drainIntervalMs ?? 60_000;
  }

  private currentState: LoadedState | null = null;

  /**
   * Live drivers, one per target, reused across drain cycles.
   *
   * Rebuilding them every cycle was expensive in three separate ways: a new
   * S3Client (and its socket pool) every 60 s, a fresh Google Drive folder
   * lookup on every call, and — worst — a decrypt of the stored credentials,
   * which on Windows spawns a PowerShell process. Once a minute. Forever.
   *
   * The cache key is the target's `config_ref`, which `updateTarget` rotates
   * whenever the configuration changes, so edited credentials are picked up
   * on the next cycle without any explicit invalidation.
   */
  private readonly driverCache = new Map<string, { configRef: string; driver: StorageDriver }>();

  /**
   * The enabled targets, as live cached drivers. Public so the setup service
   * shares this cache instead of building a second set of drivers (and, on
   * Windows, spawning a second PowerShell decrypt) for the same targets.
   */
  async enabledTargets(): Promise<Array<{ id: string; driver: StorageDriver }>> {
    const rows = await this.db.client
      .select()
      .from(cloudTargets)
      .where(eq(cloudTargets.enabled, true))
      .orderBy(cloudTargets.created_at);

    const out: Array<{ id: string; driver: StorageDriver }> = [];
    const seen = new Set<string>();

    for (const row of rows) {
      seen.add(row.id);
      const cached = this.driverCache.get(row.id);
      if (cached && cached.configRef === row.config_ref) {
        out.push({ id: row.id, driver: cached.driver });
        continue;
      }
      if (cached) this.disposeDriver(cached.driver);

      const secret = await this.creds.load(row.config_ref);
      if (!secret) continue;
      try {
        const driver = createDriver(JSON.parse(secret));
        this.driverCache.set(row.id, { configRef: row.config_ref, driver });
        out.push({ id: row.id, driver });
      } catch {
        this.driverCache.delete(row.id);
        this.logger.error(`Credential record for target ${row.id} is unreadable; skipping.`);
      }
    }

    // A target that was disabled or removed should release its sockets.
    for (const [id, entry] of this.driverCache) {
      if (!seen.has(id)) {
        this.disposeDriver(entry.driver);
        this.driverCache.delete(id);
      }
    }
    return out;
  }

  /**
   * Rewrites the salt and check objects on any target whose check object is
   * missing or written in an older format. A no-op on a healthy install.
   */
  private async ensureMetaObjects(state: LoadedState): Promise<void> {
    let targets: Array<{ id: string; driver: StorageDriver }>;
    try {
      targets = await this.enabledTargets();
    } catch {
      return;
    }

    for (const target of targets) {
      try {
        if (await checkObjectIsCurrent(target.driver, state.schoolId, state.key)) continue;
        await writeMetaObjects([target.driver], state.schoolId, state.kdf, state.key);
        this.logger.log(
          `Recovery-phrase check object rewritten on ${target.id} — an older format would have rejected a valid phrase.`,
        );
      } catch (err) {
        // Offline is the common case here; the next boot tries again.
        this.logger.warn(
          `Could not verify the check object on ${target.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** Releases a driver's transport, for the drivers that hold one. */
  private disposeDriver(driver: StorageDriver): void {
    (driver as { destroy?: () => void }).destroy?.();
  }

  private async claimAll(state: LoadedState): Promise<{ conflict: { hostname: string; instance_uuid: string; claimed_at: string } | null }> {
    const targets = await this.enabledTargets();
    for (const target of targets) {
      try {
        const result = await this.registry.claim(
          target.driver,
          state.schoolId,
          state.instanceUuid,
          state.hostname,
          process.env.APP_VERSION,
        );
        if (result.conflict) {
          return { conflict: { hostname: result.conflict.hostname, instance_uuid: result.conflict.instance_uuid, claimed_at: result.conflict.claimed_at } };
        }
      } catch {
        // One unreachable target must not block startup — the registry check
        // runs again on the next heartbeat.
        this.logger.warn(`Instance registry check failed against ${target.id} — retrying later.`);
      }
    }
    return { conflict: null };
  }

  private scheduleDrain(state: LoadedState): void {
    const run = () => {
      void this.drainOnce(state).finally(() => {
        this.drainTimer = setTimeout(run, this.drainIntervalMs());
      });
    };
    this.drainTimer = setTimeout(run, this.drainIntervalMs());
  }

  private scheduleSnapshot(state: LoadedState): void {
    const run = () => {
      void this.snapshotNow(state);
      // Re-arm for tomorrow at the quiet hour.
      this.snapshotTimer = setTimeout(run, msUntilNextQuietHour(state.quietHour));
    };
    this.snapshotTimer = setTimeout(run, msUntilNextQuietHour(state.quietHour));
  }

  private async snapshotNow(state: LoadedState): Promise<void> {
    try {
      await this.snapshots.runSnapshot(await this.enabledTargets(), state.key, state.schoolId, state.kdf, "daily");
      await this.db.client
        .update(cloudState)
        .set({ last_manifest_at: new Date() })
        .where(eq(cloudState.singleton, "global"));

      // A shipped row older than the newest snapshot is definitively covered
      // by it, so this is the safe moment to trim the local buffer.
      const pruned = await this.queue.pruneSent();
      if (pruned > 0) this.logger.log(`Pruned ${pruned} shipped queue rows older than 30 days.`);
    } catch (err) {
      this.logger.error(`Daily snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Drains the queue once. Returns true when work was done. */
  async drainOnce(state?: LoadedState): Promise<boolean> {
    if (this.syncing) return false;
    // A standing conflict means another machine claims this namespace;
    // syncing anyway is exactly the divergent history the guard exists to
    // prevent.
    if (this.conflict) return false;
    const st = state ?? (await this.loadState());
    if (!st || !this.keys.getRuntimeKey()) return false;

    const targets = await this.enabledTargets();
    if (targets.length === 0) return false;

    this.syncing = true;
    try {
      // Bring back anything a previous cycle failed on, BEFORE reading the
      // next batch. Without this a transient failure became a permanent gap
      // in the sequence the restore replay depends on — and replay skips a
      // gap silently rather than reporting it.
      const requeued = await this.queue.requeueRetryable();
      if (requeued > 0) {
        this.logger.log(`Requeued ${requeued} previously failed rows for retry.`);
      }

      const batch = await this.queue.nextBatch(BATCH_MAX_ROWS, BATCH_MAX_BYTES);
      if (batch.rows.length === 0) {
        this.lastDrainAt = new Date();
        return false;
      }

      const lines = batch.rows.map((row) =>
        JSON.stringify({
          seq: row.id,
          entity_table: row.entityTable,
          entity_id: row.entityId,
          operation: row.operation,
          payload: row.payload,
          occurred_at: row.occurredAt.toISOString(),
          actor_user_id: row.actorUserId,
        }),
      );
      const jsonl = Buffer.from(lines.join("\n") + "\n", "utf8");
      const objectKey = `${st.schoolId}/events/${isoDate()}/${batch.fromSeq}-${batch.toSeq}.jsonl.zst.enc`;

      const encoded = await encodeObject({
        schoolId: st.schoolId,
        objectKey,
        kind: "event_batch",
        kdf: st.kdf,
        key: st.key,
        compression: compressionAlgorithm(),
        seqFrom: batch.fromSeq,
        seqTo: batch.toSeq,
        plaintext: () => Readable.from([jsonl]),
      });

      const batchId = randomUUID();
      let reachedAtLeastOne = false;
      for (const target of targets) {
        try {
          // Idempotent re-upload: a batch key names its exact sequence
          // range, so a retry carries the same events. Without overwrite a
          // first attempt that landed but failed to acknowledge wedges the
          // queue forever (Dropbox 409, folder "already exists"): every
          // retry collides, every cycle marks failed, nothing ever drains.
          await target.driver.put(objectKey, encoded.openStream(), encoded.size, { overwrite: true });
          await this.db.client
            .insert(backupManifest)
            .values({
              target_id: target.id,
              object_key: objectKey,
              kind: "event_batch",
              covers_from_seq: batch.fromSeq,
              covers_to_seq: batch.toSeq,
              uncompressed_sha256: encoded.header.uncompressed_sha256,
              uncompressed_bytes: encoded.header.uncompressed_bytes,
              stored_bytes: encoded.size,
              format_version: encoded.header.format_version,
            })
            .onConflictDoNothing();
          await this.db.client
            .update(cloudTargets)
            .set({ last_success_at: new Date(), last_error: null, consecutive_failures: 0 })
            .where(eq(cloudTargets.id, target.id));
          reachedAtLeastOne = true;
        } catch (err) {
          await this.db.client
            .update(cloudTargets)
            .set({
              last_error: err instanceof Error ? err.message : String(err),
              consecutive_failures: sql`${cloudTargets.consecutive_failures} + 1`,
            })
            .where(eq(cloudTargets.id, target.id));
          this.logger.error(`Batch upload to ${target.id} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (reachedAtLeastOne) {
        await this.queue.markSent(batch.rows.map((r) => r.id), batchId);
      } else {
        await this.queue.markFailed(batch.rows.map((r) => r.id), "Toutes les destinations ont échoué.");
      }
      // Keep this instance's claim fresh. Without a heartbeat the claim ages
      // past ACTIVE_TTL_MS and a second machine is allowed to start syncing
      // alongside this one.
      await this.heartbeatAll(st, targets);
      this.lastDrainAt = new Date();
      return true;
    } catch (err) {
      this.logger.error(`Drain cycle failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Re-asserts this instance's claim on every reachable target.
   *
   * `heartbeat()` existed but was called from nowhere, so a claim written at
   * boot aged forever: a dead machine blocked its replacement, and a live one
   * could not tell a rival from a ghost.
   */
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

  /** Connectivity probe (lightweight) — a single target's reachability. */
  async probeTarget(target: { id: string; driver: StorageDriver }): Promise<boolean> {
    try {
      await target.driver.testConnection();
      await this.db.client
        .update(cloudTargets)
        .set({ last_success_at: new Date(), last_error: null, consecutive_failures: 0 })
        .where(eq(cloudTargets.id, target.id));
      return true;
    } catch (err) {
      await this.db.client
        .update(cloudTargets)
        .set({
          last_error: err instanceof Error ? err.message : String(err),
          consecutive_failures: sql`${cloudTargets.consecutive_failures} + 1`,
        })
        .where(eq(cloudTargets.id, target.id));
      return false;
    }
  }
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function msUntilNextQuietHour(quietHour: number): number {
  const h = Number.isFinite(quietHour) ? quietHour : 3;
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}