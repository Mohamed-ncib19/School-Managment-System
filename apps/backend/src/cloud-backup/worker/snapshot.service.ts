import { Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, statSync } from "node:fs";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DbService } from "../../db/db.service";
import { backupManifest, cloudState, syncQueue } from "../../db/schema";
import { eq, max } from "drizzle-orm";
import type { StorageDriver } from "../drivers/storage-driver";
import { encodeObject } from "../crypto/object-codec";
import { compressionAlgorithm } from "../crypto/compression";
import type { KdfParams } from "../crypto/kdf";
import { RedactingLogger } from "../redaction/redaction";
import { findPgBin } from "./pg-bin";
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

  private async dbConfig(): Promise<{
    user: string;
    password: string;
    host: string;
    port: number;
    database: string;
  }> {
    const url = process.env.DATABASE_URL ?? "";
    const m = url.match(/^postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
    if (!m) throw new Error("DATABASE_URL n'est pas une chaîne de connexion PostgreSQL valide");
    return {
      user: m[1],
      password: m[2],
      host: m[3],
      port: parseInt(m[4], 10),
      database: m[5].split("?")[0],
    };
  }

  private findPgDump(): string | null {
    return findPgBin("pg_dump");
  }

  private async dumpToFile(targetPath: string): Promise<void> {
    const cfg = await this.dbConfig();
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
        { env: { ...process.env, PGPASSWORD: cfg.password }, windowsHide: true, stdio: ["ignore", "pipe", "inherit"] },
      );
      const out = createWriteStream(targetPath, { flags: "w" });
      child.stdout.pipe(out);
      child.on("error", reject);
      out.on("error", reject);
      child.on("close", (code) => {
        out.end();
        if (code !== 0) reject(new Error(`pg_dump exited with code ${code}`));
        else resolve();
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

  private async state(): Promise<{ schoolId: string; kdf: KdfParams; key: Buffer } | null> {
    const row = await this.db.client.query.cloudState.findFirst({ where: eq(cloudState.singleton, "global") });
    if (!row?.school_id || !row.kdf_salt) return null;
    const params = JSON.parse(row.kdf_salt) as KdfParams;
    return { schoolId: row.school_id, kdf: params, key: Buffer.alloc(0) };
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

  /** Sha256 of the schema file — compared at boot to detect a migration. */
  async schemaHash(): Promise<string> {
    const schemaPath = join(process.cwd(), "src", "db", "schema.ts");
    try {
      const content = await readFile(schemaPath, "utf8");
      return createHash("sha256").update(content).digest("hex");
    } catch {
      return "";
    }
  }
}