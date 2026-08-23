import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir, hostname as osHostname } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { eq, sql, param } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { cloudState, restoreProgress } from "../../db/schema";
import type { StorageDriver } from "../drivers/storage-driver";
import { createDriver, DriverConfigRecord } from "../drivers/driver-registry";
import type { KdfParams } from "../crypto/kdf";
import { splitObject, ObjectHeader } from "../crypto/object-header";
import { buildCheckPlaintext } from "../crypto/check-object";
import { decodeObject, decodeObjectToFile } from "../crypto/object-codec";
import { CloudKeyService } from "../credential-store/cloud-key.service";
import { InstanceRegistryService } from "../registry/instance-registry.service";
import { SYNCED_TABLES } from "../queue/sync-trigger-bootstrap";
import { withSyncDisabled } from "../queue/sync-context";
import { findPgBin } from "../worker/pg-bin";
import { RedactingLogger } from "../redaction/redaction";

/**
 * Disaster-recovery restore. Runs from the login screen on a NEW machine (the
 * old one is presumed dead): the admin enters the cloud target credentials,
 * the school ID and the recovery phrase; this service derives the key, verifies
 * the known-plaintext check object, rebuilds the database from the latest
 * snapshot, replays every event batch that happened after it, and claims the
 * new instance in the cloud registry.
 *
 * The process is resumable: `restore_progress` records the last applied event
 * sequence, so an interrupted rebuild resumes where it stopped instead of
 * restarting or presenting a half-restored database as complete.
 *
 * Security: the endpoint is unauthenticated by design (the old hardware is
 * gone, there is no session yet), but it refuses to run when this database
 * already has an active backup (a live instance), and every step requires the
 * recovery phrase — an attacker without it cannot even enumerate objects.
 */

export interface RestoreTargetInput {
  driverId: string;
  config: Record<string, string>;
}

export interface RestoreInput {
  target: RestoreTargetInput;
  schoolId: string;
  phrase: string;
}

export interface RestorePlan {
  jobId: string;
  schoolId: string;
  snapshot: { key: string; created_at: string; covers_to_seq: number; uncompressed_bytes: number } | null;
  eventBatches: Array<{ key: string; from: number; to: number }>;
  appliedThroughSeq: number;
  totalEvents: number;
  objectCount: number;
}

export interface RestoreStatus {
  jobId: string;
  state: string;
  snapshotKey: string | null;
  appliedThroughSeq: number;
  updatedAt: Date | null;
}

@Injectable()
export class RestoreService {
  private readonly logger = new RedactingLogger(RestoreService.name);
  private readonly pkCache = new Map<string, string[]>();

  constructor(
    private readonly db: DbService,
    private readonly keys: CloudKeyService,
    private readonly registry: InstanceRegistryService,
  ) {}

  /** Refuses to restore on top of a live instance. */
  private async assertDbIsFresh(): Promise<void> {
    const row = await this.db.client.query.cloudState.findFirst({ where: eq(cloudState.singleton, "global") });
    if (row?.setup_complete) {
      throw new BadRequestException(
        "Cette installation a déjà une sauvegarde active. Pour restaurer, réinstallez sur un poste vide ou retirez d'abord la sauvegarde.",
      );
    }
  }

  private makeDriver(input: RestoreTargetInput): StorageDriver {
    return createDriver({ driver: input.driverId as DriverConfigRecord["driver"], config: input.config });
  }

  /** Reads just the plaintext header of an object without downloading the body. */
  private async readHeader(driver: StorageDriver, key: string): Promise<ObjectHeader> {
    const stream = await driver.get(key);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      chunks.push(buf);
      total += buf.length;
      if (total >= 4) {
        const length = chunks[0].readUInt32BE(0);
        if (total >= 4 + length) break;
      }
    }
    const { header } = splitObject(Buffer.concat(chunks));
    return header;
  }

  private async saltFromCloud(driver: StorageDriver, schoolId: string): Promise<KdfParams> {
    const stream = await driver.get(`${schoolId}/meta/salt.json`);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { kdf: KdfParams; school_id: string };
    if (parsed.school_id !== schoolId) throw new BadRequestException("L'identifiant d'école ne correspond pas à cette sauvegarde.");
    return parsed.kdf;
  }

  /** Step 1 — connect, derive the key, verify the phrase, list what exists. */
  async startRestore(input: RestoreInput): Promise<RestorePlan> {
    await this.assertDbIsFresh();
    const driver = this.makeDriver(input.target);
    await driver.testConnection();

    const kdf = await this.saltFromCloud(driver, input.schoolId);
    const key = await this.keys.deriveFromPhrase(input.phrase, kdf);

    // Known-plaintext check: the phrase is correct iff this decodes.
    const checkBytes = await this.readWhole(driver, `${input.schoolId}/meta/check.json.enc`);
    const check = await decodeObject(checkBytes, key);
    const expected = buildCheckPlaintext(input.schoolId);
    if (check.plaintext.toString("utf8") !== expected) {
      throw new BadRequestException("Phrase de récupération invalide pour cet identifiant d'école.");
    }

    const snapshots = (await driver.list(`${input.schoolId}/snapshots/`)).sort((a, b) => a.key.localeCompare(b.key));
    const eventPrefixes = (await driver.list(`${input.schoolId}/events/`))
      .map((m) => m.key)
      .filter((k) => k.endsWith(".jsonl.zst.enc"))
      .sort((a, b) => a.localeCompare(b));

    const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1].key : null;
    const snapshotHeader = latestSnapshot ? await this.readHeader(driver, latestSnapshot) : null;

    const eventBatches: Array<{ key: string; from: number; to: number }> = [];
    for (const key of eventPrefixes) {
      const header = await this.readHeader(driver, key);
      if (header.seq_from == null || header.seq_to == null) continue;
      if (snapshotHeader && snapshotHeader.seq_to != null && header.seq_to <= snapshotHeader.seq_to) continue;
      eventBatches.push({ key, from: header.seq_from, to: header.seq_to });
    }
    eventBatches.sort((a, b) => a.from - b.from);

    const jobId = randomUUID();
    await this.db.client
      .insert(restoreProgress)
      .values({
        job_id: jobId,
        snapshot_key: latestSnapshot ?? "",
        applied_through_seq: snapshotHeader?.seq_to ?? 0,
        state: "discovered",
      })
      .onConflictDoUpdate({
        target: restoreProgress.job_id,
        set: {
          snapshot_key: latestSnapshot ?? "",
          applied_through_seq: snapshotHeader?.seq_to ?? 0,
          state: "discovered",
        },
      });

    this.logger.log(`Restore job ${jobId}: snapshot ${latestSnapshot ?? "none"}, ${eventBatches.length} event batches to replay.`);
    return {
      jobId,
      schoolId: input.schoolId,
      snapshot: snapshotHeader
        ? {
            key: latestSnapshot!,
            created_at: snapshotHeader.created_at,
            covers_to_seq: snapshotHeader.seq_to ?? 0,
            uncompressed_bytes: snapshotHeader.uncompressed_bytes,
          }
        : null,
      eventBatches,
      appliedThroughSeq: snapshotHeader?.seq_to ?? 0,
      totalEvents: eventBatches.reduce((a, b) => a + (b.to - b.from + 1), 0),
      objectCount: snapshots.length + eventBatches.length,
    };
  }

  async status(jobId: string): Promise<RestoreStatus> {
    const row = await this.db.client.query.restoreProgress.findFirst({ where: eq(restoreProgress.job_id, jobId) });
    if (!row) throw new NotFoundException("Aucun travail de restauration avec cet identifiant.");
    return {
      jobId,
      state: row.state,
      snapshotKey: row.snapshot_key,
      appliedThroughSeq: row.applied_through_seq,
      updatedAt: row.updated_at,
    };
  }

  /** Step 2 — download the latest snapshot and load it into this database. */
  async applySnapshot(jobId: string, target: RestoreTargetInput, schoolId: string, phrase: string): Promise<void> {
    const job = await this.db.client.query.restoreProgress.findFirst({ where: eq(restoreProgress.job_id, jobId) });
    if (!job) throw new NotFoundException("Travail de restauration inconnu.");
    if (!job.snapshot_key) throw new BadRequestException("Aucune capture à restaurer.");

    const driver = this.makeDriver(target);
    const kdf = await this.saltFromCloud(driver, schoolId);
    const key = await this.keys.deriveFromPhrase(phrase, kdf);

    const dir = await mkdtemp(join(tmpdir(), "iq-restore-"));
    const sqlFile = join(dir, "snapshot.sql");
    try {
      const header = await this.readHeader(driver, job.snapshot_key);
      const stream = await driver.get(job.snapshot_key);
      const { bytes } = await decodeObjectToFile(stream, key, header, sqlFile);
      this.logger.log(`Snapshot decoded (${bytes} bytes) — loading into database.`);
      await this.loadSqlFile(sqlFile);

      await this.db.client
        .update(restoreProgress)
        .set({ state: "snapshot_applied" })
        .where(eq(restoreProgress.job_id, jobId));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async loadSqlFile(path: string): Promise<void> {
    const cfg = await this.dbConfig();
    const run = (binary: string) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(
          binary,
          ["-U", cfg.user, "-h", cfg.host, "-p", String(cfg.port), "-d", cfg.database, "-v", "ON_ERROR_STOP=1", "-f", path],
          { env: { ...process.env, PGPASSWORD: cfg.password }, windowsHide: true, stdio: ["ignore", "pipe", "inherit"] },
        );
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`psql exited with code ${code}`))));
      });

    const psql = findPgBin("psql");
    if (psql) {
      try {
        await run(psql);
        return;
      } catch {
        /* fall through to PATH */
      }
    }
    const { execFile } = await import("node:child_process");
    await promisify(execFile)(
      "psql",
      ["-U", cfg.user, "-h", cfg.host, "-p", String(cfg.port), "-d", cfg.database, "-v", "ON_ERROR_STOP=1", "-f", path],
      { env: { ...process.env, PGPASSWORD: cfg.password }, timeout: 30 * 60_000 },
    );
  }

  /** Step 3 — replay every event batch newer than the snapshot, in order. */
  async replayEvents(
    jobId: string,
    target: RestoreTargetInput,
    schoolId: string,
    phrase: string,
  ): Promise<{ appliedThroughSeq: number; appliedCount: number }> {
    const job = await this.db.client.query.restoreProgress.findFirst({ where: eq(restoreProgress.job_id, jobId) });
    if (!job) throw new NotFoundException("Travail de restauration inconnu.");

    const driver = this.makeDriver(target);
    const kdf = await this.saltFromCloud(driver, schoolId);
    const key = await this.keys.deriveFromPhrase(phrase, kdf);

    const eventPrefixes = (await driver.list(`${schoolId}/events/`))
      .map((m) => m.key)
      .filter((k) => k.endsWith(".jsonl.zst.enc"));
    const batches: Array<{ key: string; from: number; to: number }> = [];
    for (const key of eventPrefixes) {
      const header = await this.readHeader(driver, key);
      if (header.seq_from == null || header.seq_to == null) continue;
      if (header.seq_to <= job.applied_through_seq) continue;
      batches.push({ key, from: header.seq_from, to: header.seq_to });
    }
    batches.sort((a, b) => a.from - b.from);

    let applied = 0;
    for (const batch of batches) {
      const bytes = await this.readWhole(driver, batch.key);
      const decoded = await decodeObject(bytes, key);
      const lines = decoded.plaintext.toString("utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        const event = JSON.parse(line) as {
          seq: number;
          entity_table: string;
          entity_id: string;
          operation: "insert" | "update" | "delete";
          payload: Record<string, unknown>;
          occurred_at?: string;
          actor_user_id?: string | null;
        };
        if (event.seq <= job.applied_through_seq) continue;
        await withSyncDisabled(this.db, async (tx) => {
          await this.applyEvent(tx, event);
        });
        applied++;
      }
      await this.db.client
        .update(restoreProgress)
        .set({ applied_through_seq: batch.to, state: "replaying" })
        .where(eq(restoreProgress.job_id, jobId));
    }

    await this.db.client
      .update(restoreProgress)
      .set({ state: "replayed" })
      .where(eq(restoreProgress.job_id, jobId));
    const through = batches[batches.length - 1]?.to ?? job.applied_through_seq;
    this.logger.log(`Replay finished: ${applied} events applied, through seq ${through}.`);
    return { appliedThroughSeq: through, appliedCount: applied };
  }

  /** Step 4 — adopt this machine as the active instance. */
  async finishRestore(
    jobId: string,
    target: RestoreTargetInput,
    schoolId: string,
    phrase: string,
  ): Promise<{ instanceUuid: string; hostname: string }> {
    const job = await this.db.client.query.restoreProgress.findFirst({ where: eq(restoreProgress.job_id, jobId) });
    if (!job) throw new NotFoundException("Travail de restauration inconnu.");
    if (job.state !== "replayed") {
      throw new BadRequestException("La restauration n'est pas terminée (rejeu des événements requis).");
    }

    const driver = this.makeDriver(target);
    const kdf = await this.saltFromCloud(driver, schoolId);
    const wrapped = await this.keys.wrapFromPhrase(phrase, kdf);

    const instanceUuid = randomUUID();
    const hostname = osHostname() || "unknown-host";
    const schemaHash = await this.schemaHash();

    // The snapshot restores a cloud_state row from the old machine; adopt it.
    const existing = await this.db.client.query.cloudState.findFirst({ where: eq(cloudState.singleton, "global") });
    if (existing) {
      await this.db.client
        .update(cloudState)
        .set({
          school_id: schoolId,
          instance_uuid: instanceUuid,
          hostname,
          setup_complete: true,
          verify_complete: true,
          wrapped_key: wrapped.wrapped,
          wrap_salt: wrapped.wrapSalt,
          schema_hash: schemaHash,
        })
        .where(eq(cloudState.singleton, "global"));
    } else {
      await this.db.client.insert(cloudState).values({
        singleton: "global",
        school_id: schoolId,
        instance_uuid: instanceUuid,
        hostname,
        setup_complete: true,
        verify_complete: true,
        wrapped_key: wrapped.wrapped,
        wrap_salt: wrapped.wrapSalt,
        schema_hash: schemaHash,
      });
    }

    await this.registry.claim(driver, schoolId, instanceUuid, hostname);
    await this.db.client.update(restoreProgress).set({ state: "complete" }).where(eq(restoreProgress.job_id, jobId));
    this.logger.log(`Restore complete: instance ${instanceUuid} is now active for school ${schoolId}.`);
    return { instanceUuid, hostname };
  }

  private async applyEvent(
    tx: DbService["client"],
    event: { entity_table: string; entity_id: string; operation: string; payload: Record<string, unknown> },
  ): Promise<void> {
    if (!SYNCED_TABLES.includes(event.entity_table as (typeof SYNCED_TABLES)[number])) {
      this.logger.warn(`Skipping non-synced table in replay: ${event.entity_table}`);
      return;
    }
    const table = event.entity_table;
    const pks = await this.pkColumns(tx, table);
    if (pks.length === 0) throw new Error(`No primary key found for ${table} — replay cannot continue.`);

    const allowed = await this.columnNames(tx, table);
    const insertColumns = Object.keys(event.payload).filter((c) => allowed.has(c));
    if (insertColumns.length === 0) return;

    if (event.operation === "delete") {
      const pkVal = toDbValue(event.payload[pks[0]]);
      if (pkVal == null) return;
      await tx.execute(
        sql`DELETE FROM ${sql.raw(`public."${table}"`)} WHERE ${sql.raw(`"${pks[0]}"`)} = ${param(pkVal)}`,
      );
      return;
    }

    const values = insertColumns.map((c) => toDbValue(event.payload[c]));
    const setClause = insertColumns
      .filter((c) => !pks.includes(c))
      .map((c) => `"${c}" = EXCLUDED."${c}"`)
      .join(", ");
    const stmt = sql`
      INSERT INTO ${sql.raw(`public."${table}"`)}
        (${sql.raw(insertColumns.map((c) => `"${c}"`).join(", "))})
      VALUES (${sql.join(values.map((v) => param(v)), sql.raw(", "))})
      ON CONFLICT (${sql.raw(pks.map((c) => `"${c}"`).join(", "))})
      DO UPDATE SET ${sql.raw(setClause)}
    `;
    await tx.execute(stmt);
  }

  private async pkColumns(tx: DbService["client"], table: string): Promise<string[]> {
    const cached = this.pkCache.get(table);
    if (cached) return cached;
    const result = (await tx.execute(
      sql`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = ${sql.raw(`'public.${table}'`)}::regclass AND i.indisprimary`,
    )) as unknown as { rows?: Array<{ attname: string }> };
    const names = result.rows?.map((r) => r.attname) ?? [];
    this.pkCache.set(table, names);
    return names;
  }

  private async columnNames(tx: DbService["client"], table: string): Promise<Set<string>> {
    const result = (await tx.execute(
      sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table}`,
    )) as unknown as { rows?: Array<{ column_name: string }> };
    return new Set(result.rows?.map((r) => r.column_name) ?? []);
  }

  private async readWhole(driver: StorageDriver, key: string): Promise<Buffer> {
    const stream = await driver.get(key);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
    return Buffer.concat(chunks);
  }

  private async dbConfig(): Promise<{ user: string; password: string; host: string; port: number; database: string }> {
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

  private async schemaHash(): Promise<string> {
    try {
      const content = await readFile(join(process.cwd(), "src", "db", "schema.ts"), "utf8");
      return createHash("sha256").update(content).digest("hex");
    } catch {
      return "";
    }
  }

  async cancel(jobId: string): Promise<void> {
    await this.db.client.delete(restoreProgress).where(eq(restoreProgress.job_id, jobId));
  }
}

function toDbValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}