import { sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Attributes every write inside `fn` to `actorUserId` for the sync triggers.
 *
 * This replaces a request interceptor that set `app.actor_user_id` with
 * `set_config(..., false)` — session scope — and fired it without awaiting.
 * That was unsound three times over, and moot a fourth: the interceptor was
 * never registered in any module, so the setting was never written at all and
 * every sync_queue row recorded a null actor.
 *
 * Even registered it would have been wrong. With a 10-connection pool the
 * set_config and the business write can land on different connections; the
 * value survives on its connection into the next, unrelated request; and the
 * actor id was interpolated straight into the statement text. Transaction-local
 * scope (`is_local = true`) is the only form that is actually correct here,
 * and it requires the caller to own the transaction — hence this helper rather
 * than an interceptor.
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
    // Parameterised, and transaction-local.
    await tx.execute(sql`SELECT set_config('app.actor_user_id', ${actorUserId}, true)`);
    return fn(tx as DbService["client"]);
  });
}

/**
 * Disable sync capture for a block that must not be mirrored (restore replay
 * writes are historical, not new events). Runs inside the caller's
 * transaction so the setting never leaks beyond it. The callback receives the
 * transaction client so its writes ride the same connection.
 */
export async function withSyncDisabled<T>(
  db: DbService,
  fn: (tx: DbService["client"]) => Promise<T>,
): Promise<T> {
  return db.client.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.sync_disabled', 'true', true)`);
    return fn(tx as DbService["client"]);
  });
}
