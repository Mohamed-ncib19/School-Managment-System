import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { hostname as osHostname } from "node:os";
import { eq } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { cloudState, cloudTargets } from "../../db/schema";
import type { StorageDriver } from "../drivers/storage-driver";
import { createDriver } from "../drivers/driver-registry";
import { SyncQueueService } from "../queue/sync-queue.service";
import { encodeObject } from "../crypto/object-codec";
import { CloudKeyService } from "../credential-store/cloud-key.service";
import { CredentialStoreService } from "../credential-store/credential-store.service";
import { InstanceRegistryService } from "../registry/instance-registry.service";
import { SnapshotService } from "./snapshot.service";
import { checkObjectIsCurrent, writeMetaObjects } from "../setup/meta-objects";
import { RedactingLogger } from "../redaction/redaction";

export type SyncState = "synced" | "offline" | "syncing" | "attention" | "disabled";

interface LoadedState {
  schoolId: string;
  key: Buffer;
  kdf: Parameters<typeof encodeObject>[0]["kdf"];
  instanceUuid: string;
  hostname: string;
}

/**
 * Export scheduler — runs one versioned data export per cycle.
 *
 * There is no continuous event drain: every backup is a full
 * Importer-compatible export, so the queue is only a local buffer trimmed
 * through the last landed export. The worker runs an export at the
 * configured quiet hour, on demand, and at boot when the schema hash has
 * changed (migration detected).
 *
 * It is never allowed to block or error the request path: it runs on its own
 * timers and swallows connectivity failures.
 */
@Injectable()
export class SyncWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  /** Auto-export cadence: upload a fresh JSON 10 s after changes land. */
  private static readonly AUTO_INTERVAL_MS = 10_000;

  private readonly logger = new RedactingLogger(SyncWorkerService.name);
  private autoTimer: NodeJS.Timeout | null = null;
  private readonly instanceHostname = osHostname() || "unknown-host";

  private syncing = false;
  private conflict: { hostname: string; instance_uuid: string; claimed_at: string } | null = null;

  isSyncing(): boolean {
    return this.syncing;
  }

  currentConflict(): { hostname: string; instance_uuid: string; claimed_at: string } | null {
    return this.conflict;
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

      // Migration detection: a changed schema means the last export predates
      // the schema the backups describe — take one immediately.
      const hash = await this.snapshots.schemaHash();
      const row = await this.db.client.query.cloudState.findFirst({ where: eq(cloudState.singleton, "global") });
      if (row && row.schema_hash && row.schema_hash !== hash) {
        this.logger.log("Schema changed since last export — taking an immediate export.");
        await this.snapshots.runSnapshot(await this.enabledTargets(), state.key, state.schoolId, state.kdf, "migration");
        await this.db.client
          .update(cloudState)
          .set({ schema_hash: hash })
          .where(eq(cloudState.singleton, "global"));
      }

      this.scheduleAuto(state);
      this.logger.log("Sync worker active: exporting 10 s after changes land.");
    } catch (err) {
      this.logger.error(`Sync worker failed to start: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.autoTimer) clearTimeout(this.autoTimer);
    for (const entry of this.driverCache.values()) this.disposeDriver(entry.driver);
    this.driverCache.clear();
  }

  private async loadState(): Promise<LoadedState | null> {
    const row = await this.db.client.query.cloudState.findFirst({ where: eq(cloudState.singleton, "global") });
    if (!row?.school_id || !row.kdf_salt || !row.wrapped_key || !row.wrap_salt) return null;
    const kdf = JSON.parse(row.kdf_salt) as LoadedState["kdf"];
    const key = await this.keys.unwrap(row.wrapped_key, row.wrap_salt);
    return {
      schoolId: row.school_id,
      key,
      kdf,
      instanceUuid: row.instance_uuid,
      hostname: this.instanceHostname,
    };
  }

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

  private scheduleAuto(state: LoadedState): void {
    const run = () => {
      void this.autoOnce(state).finally(() => {
        this.autoTimer = setTimeout(run, SyncWorkerService.AUTO_INTERVAL_MS);
      });
    };
    this.autoTimer = setTimeout(run, SyncWorkerService.AUTO_INTERVAL_MS);
  }

  /**
   * One auto tick: export only when the toggle is on and the change buffer
   * is non-empty. The flag is re-read every tick so flipping the switch in
   * Settings takes effect within seconds without a restart.
   */
  private async autoOnce(state: LoadedState): Promise<void> {
    if (this.conflict || this.syncing) return;
    try {
      const row = await this.db.client.query.cloudState.findFirst({
        where: eq(cloudState.singleton, "global"),
      });
      if (!row?.setup_complete || row.auto_export === false) return;
      const stats = await this.queue.stats();
      if (stats.pending === 0) return;
      await this.snapshotNow(state);
    } catch (err) {
      this.logger.error(`Auto export check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async snapshotNow(state: LoadedState): Promise<void> {
    // A standing conflict means another machine claims this namespace;
    // exporting anyway would fork the version history the guard exists to
    // keep single-writer.
    if (this.conflict) return;
    this.syncing = true;
    try {
      // Re-read the sealed key instead of reusing the bootstrap one: a re-key
      // (new password) lands in the database immediately, and every export
      // after it must use the new key — otherwise auto exports keep shipping
      // the old key while the cloud check object already expects the new one.
      const fresh = await this.loadState();
      const current = fresh ?? state;
      await this.snapshots.runSnapshot(await this.enabledTargets(), current.key, current.schoolId, current.kdf, "daily");
      await this.db.client
        .update(cloudState)
        .set({ last_manifest_at: new Date() })
        .where(eq(cloudState.singleton, "global"));
    } catch (err) {
      this.logger.error(`Daily export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.syncing = false;
    }
  }
}