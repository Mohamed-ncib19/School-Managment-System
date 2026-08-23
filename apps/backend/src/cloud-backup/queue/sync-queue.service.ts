import { Injectable } from "@nestjs/common";
import { and, asc, count, eq, inArray, lt, sql, SQL } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { syncQueue } from "../../db/schema";
import { RedactingLogger } from "../redaction/redaction";

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

  /** Re-queues failed rows so a later drain retries them in order. */
  async retryFailed(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.client
      .update(syncQueue)
      .set({ status: "pending" })
      .where(inArray(syncQueue.id, ids));
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

  /** Count of pending rows older than a cutoff — feeds the Attention state. */
  async pendingOlderThan(cutoff: Date): Promise<number> {
    const rows = await this.db.client
      .select({ c: count() })
      .from(syncQueue)
      .where(and(eq(syncQueue.status, "pending"), lt(syncQueue.occurred_at, cutoff)));
    return rows[0]?.c ?? 0;
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