import { Injectable } from "@nestjs/common";
import { and, asc, count, eq, inArray, lt, sql, SQL } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { syncQueue } from "../../db/schema";
import { RedactingLogger } from "../redaction/redaction";

/**
 * How many times a row may fail before it stops being retried automatically.
 * A row that hits the ceiling stays `failed` and is surfaced in Settings →
 * Data safety, because at that point the problem is not transient.
 */
export const MAX_ATTEMPTS = 10;

export interface PendingBatch {
  rows: Array<{
    id: number;
    entityTable: string;
    entityId: string;
    operation: "insert" | "update" | "delete";
    payload: Record<string, unknown>;
    occurredAt: Date;
    actorUserId: string | null;
  }>;
  fromSeq: number;
  toSeq: number;
}

export interface QueueStats {
  pending: number;
  failed: number;
  total: number;
  oldestPendingAt: Date | null;
  pendingBytes: number;
}

/**
 * Durable sync queue. Rows are written by the capture triggers in the same
 * transaction as the business write, survive app restarts and OS crashes (they
 * are ordinary committed rows), and are never dropped, trimmed or truncated —
 * even a permanently failing target leaves the queue intact so nothing is
 * silently lost.
 */
@Injectable()
export class SyncQueueService {
  private readonly logger = new RedactingLogger(SyncQueueService.name);

  constructor(private readonly db: DbService) {}

  /** The next batch of pending rows in sequence order (oldest first). */
  async nextBatch(maxRows: number, maxBytes: number): Promise<PendingBatch> {
    const rows = await this.db.client
      .select({
        id: syncQueue.id,
        entityTable: syncQueue.entity_table,
        entityId: syncQueue.entity_id,
        operation: syncQueue.operation,
        payload: syncQueue.payload_json,
        occurredAt: syncQueue.occurred_at,
        actorUserId: syncQueue.actor_user_id,
      })
      .from(syncQueue)
      .where(eq(syncQueue.status, "pending"))
      .orderBy(asc(syncQueue.id))
      .limit(maxRows);

    let bytes = 0;
    const batch: PendingBatch["rows"] = [];
    for (const row of rows) {
      const size = JSON.stringify(row.payload).length;
      if (batch.length > 0 && bytes + size > maxBytes) break;
      bytes += size;
      batch.push({
        id: row.id,
        entityTable: row.entityTable,
        entityId: row.entityId,
        operation: row.operation as PendingBatch["rows"][number]["operation"],
        payload: row.payload as Record<string, unknown>,
        occurredAt: row.occurredAt,
        actorUserId: row.actorUserId,
      });
      if (batch.length >= maxRows) break;
    }

    return {
      rows: batch,
      fromSeq: batch.length > 0 ? batch[0].id : 0,
      toSeq: batch.length > 0 ? batch[batch.length - 1].id : 0,
    };
  }

  /** Marks a batch as sent once it reached at least one target. */
  async markSent(ids: number[], batchId: string): Promise<void> {
    if (ids.length === 0) return;
    await this.db.client
      .update(syncQueue)
      .set({ status: "sent", batch_id: batchId })
      .where(inArray(syncQueue.id, ids));
  }

  /** Marks a batch as failed (targets all errored); rows stay in the queue. */
  async markFailed(ids: number[], error: string): Promise<void> {
    if (ids.length === 0) return;
    await this.db.client
      .update(syncQueue)
      .set({
        status: "failed",
        attempts: sql`${syncQueue.attempts} + 1`,
        last_error: error,
      })
      .where(inArray(syncQueue.id, ids));
  }

  /**
   * Returns failed rows under the attempt ceiling to `pending` so the next
   * drain retries them in sequence order.
   *
   * This is what keeps the event stream contiguous. The previous method took
   * an explicit id list and was called by nothing, so one network blip parked
   * rows in `failed` permanently while later batches marched on — leaving a
   * gap that the restore replay skips silently.
   */
  async requeueRetryable(maxAttempts: number = MAX_ATTEMPTS): Promise<number> {
    const rows = await this.db.client
      .update(syncQueue)
      .set({ status: "pending" })
      .where(and(eq(syncQueue.status, "failed"), lt(syncQueue.attempts, maxAttempts)))
      .returning({ id: syncQueue.id });
    return rows.length;
  }

  /**
   * Deletes every queued row at or below `seq`, whatever its status.
   *
   * Export-only backups ship no event batches: a full data export already
   * contains every row the queue describes, so once an export covering `seq`
   * has landed on at least one target the rows below it are covered and the
   * buffer is trimmed to bound the table. Never call this before a
   * successful export.
   */
  async pruneThrough(seq: number): Promise<number> {
    if (seq <= 0) return 0;
    // lt(id, seq + 1) instead of lte: keeps the drizzle import list unchanged.
    const rows = await this.db.client
      .delete(syncQueue)
      .where(lt(syncQueue.id, seq + 1))
      .returning({ id: syncQueue.id });
    return rows.length;
  }

  async stats(): Promise<QueueStats> {
    const [pendingRow, failedRow, totalRow, oldestRow, bytesRow] = await Promise.all([
      this.db.client
        .select({ c: count() })
        .from(syncQueue)
        .where(eq(syncQueue.status, "pending")),
      this.db.client
        .select({ c: count() })
        .from(syncQueue)
        .where(eq(syncQueue.status, "failed")),
      this.db.client.select({ c: count() }).from(syncQueue),
      this.db.client
        .select({ at: syncQueue.occurred_at })
        .from(syncQueue)
        .where(eq(syncQueue.status, "pending"))
        .orderBy(asc(syncQueue.id))
        .limit(1),
      this.db.client
        .select({ bytes: sql<number>`coalesce(sum(pg_column_size(payload_json)), 0)::int` })
        .from(syncQueue)
        .where(eq(syncQueue.status, "pending")),
    ]);

    return {
      pending: pendingRow[0]?.c ?? 0,
      failed: failedRow[0]?.c ?? 0,
      total: totalRow[0]?.c ?? 0,
      oldestPendingAt: oldestRow[0]?.at ?? null,
      pendingBytes: bytesRow[0]?.bytes ?? 0,
    };
  }

  /** Direct insert used by boot-time backfill (initial snapshot seeding). */
  async enqueue(entityTable: string, entityId: string, operation: string, payload: unknown): Promise<number> {
    const [row] = await this.db.client
      .insert(syncQueue)
      .values({
        entity_table: entityTable,
        entity_id: entityId,
        operation,
        payload_json: payload as SQL,
      })
      .returning({ id: syncQueue.id });
    return row.id;
  }
}