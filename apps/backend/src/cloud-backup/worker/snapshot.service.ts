import { Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DbService } from "../../db/db.service";
import { parsePgUrl } from "../../common/pg-url";
import { backupManifest, syncQueue } from "../../db/schema";
import { max } from "drizzle-orm";
import type { StorageDriver } from "../drivers/storage-driver";
import { encodeObject } from "../crypto/object-codec";
import { compressionAlgorithm } from "../crypto/compression";
import type { KdfParams } from "../crypto/kdf";
import { RedactingLogger } from "../redaction/redaction";
import { findPgBin } from "./pg-bin";
import { computeSchemaHash } from "./schema-hash";
import { Readable } from "node:stream";

const PG_TIMEOUT_MS = 30 * 60_000;

/**
 * Full logical snapshots: a complete `pg_dump` of the database, compressed
 * (zstd) then encrypted (AES-256-GCM) then streamed to every target. Runs
 * daily at the configured quiet hour, on demand after setup, and at boot when
 * the schema hash has changed (i.e. right after a migration).
 *
 * Memory stays flat: pg_dump writes a plaintext temp file, a streaming
 * prepass hashes and sizes it, then the encode+upload pass streams the file
 * through the compress→encrypt pipeline in 1 MiB blocks.
 */
@Injectable()
export class SnapshotService {
  private readonly logger = new RedactingLogger(SnapshotService.name);

  constructor(private readonly db: DbService) {}


  private findPgDump(): string | null {
    return findPgBin("pg_dump");
  }

  private async dumpToFile(targetPath: string): Promise<void> {
    const cfg = parsePgUrl(process.env.DATABASE_URL ?? "");
    const pgDump = this.findPgDump();
    if (!pgDump) {
      // Fall back to pg_dump on PATH (docker/dev machines).
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileP = promisify(execFile);
      await execFileP("pg_dump", [
        "-U", cfg.user,
        "-h", cfg.host,
        "-p", String(cfg.port),
        "-d", cfg.database,
        "--format=plain",
        "--no-owner",
        "--no-privileges",
        "-f", targetPath,
      ], { env: { ...process.env, PGPASSWORD: cfg.password }, timeout: PG_TIMEOUT_MS });
      return;
    }
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

      // `pipe` ends `out` itself; the previous manual out.end() plus an
      // immediate resolve() on the child's close meant statSync could measure
      // a still-flushing file and the encoder could read a truncated dump.
      // Both the child exiting AND the file finishing must happen first.
      child.stdout.pipe(out);
      child.on("error", reject);
      out.on("error", reject);
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
  }

  /** Max sync_queue sequence at snapshot time — everything up to here is inside
   * the snapshot and needs no event replay. */
  private async maxQueueSeq(): Promise<number> {
    const rows = await this.db.client
      .select({ m: max(syncQueue.id) })
      .from(syncQueue);
    return rows[0]?.m ?? 0;
  }


  /**
   * Runs a full snapshot and uploads it to every enabled target.
   * Returns per-target results.
   */
  async runSnapshot(
    targets: Array<{ id: string; driver: StorageDriver }>,
    key: Buffer,
    schoolId: string,
    kdf: KdfParams,
    reason: string,
  ): Promise<Array<{ targetId: string; ok: boolean; key?: string; error?: string }>> {
    const dir = await mkdtemp(join(tmpdir(), "iq-snapshot-"));
    const dumpFile = join(dir, "snapshot.sql");
    try {
      await this.dumpToFile(dumpFile);
      const stat = statSync(dumpFile);
      if (stat.size === 0) throw new Error("pg_dump produced an empty snapshot");

      const seq = (await this.maxQueueSeq()) + 1;
      const isoDate = new Date().toISOString().slice(0, 10);
      const objectKey = `${schoolId}/snapshots/${isoDate}_${String(seq).padStart(10, "0")}.sql.zst.enc`;

      this.logger.log(`Snapshot (${reason}) — queue seq through ${seq} — starting.`);

      const encoded = await encodeObject({
        schoolId,
        objectKey,
        kind: "snapshot",
        kdf,
        key,
compression: compressionAlgorithm(),
        seqFrom: 0,
        seqTo: seq,
        appVersion: process.env.APP_VERSION,
        plaintext: () => createReadStream(dumpFile),
      });

      const results = [];
      for (const target of targets) {
        try {
          await target.driver.put(objectKey, encoded.openStream(), encoded.size);
          await this.db.client
            .insert(backupManifest)
            .values({
              target_id: target.id,
              object_key: objectKey,
              kind: "snapshot",
              covers_from_seq: 0,
              covers_to_seq: seq,
              uncompressed_sha256: encoded.header.uncompressed_sha256,
              uncompressed_bytes: encoded.header.uncompressed_bytes,
              stored_bytes: encoded.size,
              format_version: encoded.header.format_version,
            })
            .onConflictDoNothing();
          results.push({ targetId: target.id, ok: true, key: objectKey });
        } catch (err) {
          this.logger.error(`Snapshot upload to ${target.id} failed: ${err instanceof Error ? err.message : String(err)}`);
          results.push({ targetId: target.id, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }

      await this.uploadManifest(targets, key, schoolId, kdf, results.filter((r) => r.ok).map((r) => r.key!));
      return results;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async uploadManifest(
    targets: Array<{ id: string; driver: StorageDriver }>,
    key: Buffer,
    schoolId: string,
    kdf: KdfParams,
    objectKeys: string[],
  ): Promise<void> {
    const isoDate = new Date().toISOString().slice(0, 10);
    const objectKey = `${schoolId}/manifests/${isoDate}.json.enc`;
    const manifest = {
      school_id: schoolId,
      created_at: new Date().toISOString(),
      objects: objectKeys,
    };
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    const encoded = await encodeObject({
      schoolId,
      objectKey,
      kind: "manifest",
      kdf,
      key,
      compression: compressionAlgorithm(),
      plaintext: () => Readable.from([bytes]),
    });
    for (const target of targets) {
      try {
        await target.driver.put(objectKey, encoded.openStream(), encoded.size);
      } catch (err) {
        this.logger.error(`Manifest upload to ${target.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /** Fingerprint of the schema, compared at boot to detect a migration. */
  async schemaHash(): Promise<string> {
    return computeSchemaHash();
  }
}