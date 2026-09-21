import { Injectable } from "@nestjs/common";
import { and, desc, eq, lt, max, sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { backupManifest, cloudTargets, syncQueue } from "../../db/schema";
import type { StorageDriver } from "../drivers/storage-driver";
import { encodeObject } from "../crypto/object-codec";
import { compressionAlgorithm } from "../crypto/compression";
import type { KdfParams } from "../crypto/kdf";
import { RedactingLogger } from "../redaction/redaction";
import { computeSchemaHash } from "./schema-hash";
import { Readable } from "node:stream";
import { Optional } from "@nestjs/common";
import { DataTransferService } from "../../data-transfer/data-transfer.service";
import { SyncQueueService } from "../queue/sync-queue.service";

/**
 * Export-only backups: one Importer-compatible data export (`iq-data-export`
 * JSON with every table, compressed with zstd then encrypted with AES-256-GCM
 * under the recovery phrase) uploaded to `{school_id}/exports/latest.json`
 * and replaced on every run. It is the copy the school imports through
 * Settings → Données → "Importer des données" with the phrase. Runs
 * whenever the auto loop sees changes, on demand after setup, and at boot
 * when the schema hash has changed (i.e. right after a migration).
 *
 * The per-school folder holds that one JSON file and nothing else. The
 * legacy `snapshots/`, `events/` and `manifests/` prefixes left by earlier
 * builds are purged from each target after a successful export (`meta/`
 * stays — salt, check object and instance registry).
 */
@Injectable()
export class SnapshotService {
  private readonly logger = new RedactingLogger(SnapshotService.name);

  constructor(
    private readonly db: DbService,
    private readonly queue: SyncQueueService,
    @Optional() private readonly dataTransfer?: DataTransferService,
  ) {}


  /** Max sync_queue sequence at export time — everything up to here is inside
   * the export, so the queue can be trimmed through it afterwards. */
  private async maxQueueSeq(): Promise<number> {
    const rows = await this.db.client
      .select({ m: max(syncQueue.id) })
      .from(syncQueue);
    return rows[0]?.m ?? 0;
  }

  /** Legacy cloud prefixes from before the export-only cutover. `meta/`
   * stays — salt, check object and instance registry. */
  private static readonly LEGACY_PREFIXES = ["snapshots", "events", "manifests"];

  /**
   * Runs an export-only backup and uploads it to every enabled target.
   * Returns per-target results. Keeps the historical `runSnapshot` name so
   * the daily timer, the migration hook, the setup finish step and the
   * manual trigger keep calling one method.
   */
  async runSnapshot(
    targets: Array<{ id: string; driver: StorageDriver }>,
    key: Buffer,
    schoolId: string,
    kdf: KdfParams,
    reason: string,
  ): Promise<Array<{ targetId: string; ok: boolean; key?: string; error?: string }>> {
    const seq = (await this.maxQueueSeq()) + 1;
    this.logger.log(`Export (${reason}) — queue seq through ${seq} — starting.`);

    const results = await this.uploadDataExport(targets, key, schoolId, kdf, seq);
    const succeeded = results.filter((r) => r.ok);
    if (succeeded.length === 0) return results;

    // Every queued row through seq is inside the landed export — trim the
    // local buffer so it stays bounded between exports.
    try {
      const pruned = await this.queue.pruneThrough(seq);
      if (pruned > 0) this.logger.log(`Pruned ${pruned} queue rows covered by the export.`);
    } catch (err) {
      this.logger.error(`Queue prune failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    await this.purgeLegacyPrefixes(
      targets.filter((t) => succeeded.some((r) => r.targetId === t.id)),
      schoolId,
    );
    return results;
  }

  /**
   * Removes the pre-cutover `snapshots/`, `events/` and `manifests/` objects
   * from a target that just received a good export. Best-effort per object:
   * one failure never fails the backup. Runs on every export so an
   * interrupted cleanup finishes next time; a clean target is three cheap
   * empty listings.
   */
  private async purgeLegacyPrefixes(
    targets: Array<{ id: string; driver: StorageDriver }>,
    schoolId: string,
  ): Promise<void> {
    for (const target of targets) {
      for (const dir of SnapshotService.LEGACY_PREFIXES) {
        let items: Array<{ key: string }>;
        try {
          items = await target.driver.list(`${schoolId}/${dir}/`);
        } catch (err) {
          this.logger.warn(
            `Legacy purge list failed on ${target.id} (${dir}): ${err instanceof Error ? err.message : String(err)}`,
          );
          continue;
        }
        let removed = 0;
        for (const item of items) {
          try {
            await target.driver.remove(item.key);
            removed++;
          } catch (err) {
            this.logger.warn(
              `Legacy purge remove failed on ${target.id} (${item.key}): ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        if (removed > 0) this.logger.log(`Legacy purge on ${target.id}: removed ${removed} objects under ${dir}/.`);
      }
    }
  }

  /**
   * Builds the versioned Importer-compatible export and uploads it to every
   * enabled target. Returns per-target results and stamps each target's
   * success/error bookkeeping. An export failure (or a missing
   * DataTransferService) yields per-target errors, never a throw — the daily
   * timer and the setup finish step treat it like any failed run.
   */
  private async uploadDataExport(
    targets: Array<{ id: string; driver: StorageDriver }>,
    key: Buffer,
    schoolId: string,
    kdf: KdfParams,
    seq: number,
  ): Promise<Array<{ targetId: string; ok: boolean; key?: string; error?: string }>> {
    if (!this.dataTransfer) {
      const error = "Export de données indisponible.";
      return targets.map((target) => ({ targetId: target.id, ok: false, error }));
    }
    let plaintext: Buffer;
    try {
      ({ buffer: plaintext } = await this.dataTransfer.exportAll());
    } catch (err) {
      const error = `Data-export copy skipped (export failed): ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error(error);
      return targets.map((target) => ({ targetId: target.id, ok: false, error }));
    }
    if (!plaintext.length) {
      const error = "Data-export copy skipped (empty export).";
      this.logger.error(error);
      return targets.map((target) => ({ targetId: target.id, ok: false, error }));
    }
    // Single file per school, replaced on every run: the folder holds one
    // JSON and nothing else. `overwrite: true` below is load-bearing —
    // without it Dropbox answers 409 and the folder driver refuses.
    const objectKey = `${schoolId}/exports/latest.json.zst.enc`;
    let encoded: Awaited<ReturnType<typeof encodeObject>>;
    try {
      encoded = await encodeObject({
        schoolId,
        objectKey,
        kind: "data_export",
        kdf,
        key,
        compression: compressionAlgorithm(),
        seqFrom: 0,
        seqTo: seq,
        appVersion: process.env.APP_VERSION,
        plaintext: () => Readable.from([plaintext]),
      });
    } catch (err) {
      const error = `Data-export copy skipped (encode failed): ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error(error);
      return targets.map((target) => ({ targetId: target.id, ok: false, error }));
    }
    const results: Array<{ targetId: string; ok: boolean; key?: string; error?: string }> = [];
    for (const target of targets) {
      try {
        await target.driver.put(objectKey, encoded.openStream(), encoded.size, { overwrite: true });
        await this.db.client
          .insert(backupManifest)
          .values({
            target_id: target.id,
            object_key: objectKey,
            kind: "data_export",
            covers_from_seq: 0,
            covers_to_seq: seq,
            uncompressed_sha256: encoded.header.uncompressed_sha256,
            uncompressed_bytes: encoded.header.uncompressed_bytes,
            stored_bytes: encoded.size,
            format_version: encoded.header.format_version,
          })
          .onConflictDoNothing();
        // One file on the cloud, one recent history locally: exports can
        // land every few seconds in auto mode, so keep the 30 newest rows
        // per target. Best-effort — a trim failure never fails the backup.
        try {
          const recent = await this.db.client
            .select({ at: backupManifest.created_at })
            .from(backupManifest)
            .where(eq(backupManifest.target_id, target.id))
            .orderBy(desc(backupManifest.created_at))
            .limit(30);
          if (recent.length === 30) {
            await this.db.client
              .delete(backupManifest)
              .where(
                and(
                  eq(backupManifest.target_id, target.id),
                  lt(backupManifest.created_at, recent[recent.length - 1].at),
                ),
              );
          }
        } catch {
          // ignore — trimming is hygiene, not correctness
        }
        await this.db.client
          .update(cloudTargets)
          .set({ last_success_at: new Date(), last_error: null, consecutive_failures: 0 })
          .where(eq(cloudTargets.id, target.id));
        results.push({ targetId: target.id, ok: true, key: objectKey });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Data-export upload to ${target.id} failed: ${message}`);
        await this.db.client
          .update(cloudTargets)
          .set({
            last_error: message,
            consecutive_failures: sql`${cloudTargets.consecutive_failures} + 1`,
          })
          .where(eq(cloudTargets.id, target.id));
        results.push({ targetId: target.id, ok: false, error: message });
      }
    }
    if (results.some((r) => r.ok)) {
      this.logger.log(`Data-export copy uploaded (${plaintext.length} bytes → ${objectKey}).`);
    }
    return results;
  }

  /** Fingerprint of the schema, compared at boot to detect a migration. */
  async schemaHash(): Promise<string> {
    return computeSchemaHash();
  }
}