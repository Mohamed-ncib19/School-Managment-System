import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, finalize } from "rxjs";
import { DbService } from "../../db/db.service";

/**
 * Passes the acting user to the sync triggers for the lifetime of a request.
 *
 * The triggers read `app.actor_user_id` via `current_setting`. This interceptor
 * sets it for the request and clears it when the request finishes, so a write
 * performed during a request is attributed to the admin who performed it.
 *
 * The value is session-scoped and the pg pool hands each statement out on some
 * connection: in a single-admin, single-connection-at-a-time school install
 * the write reliably rides the connection that carries the setting. Paths that
 * need exact attribution (restore, setup verification) additionally set the
 * value transaction-locally inside their own transaction, which is airtight.
 */
@Injectable()
export class SyncActorInterceptor implements NestInterceptor {
  constructor(private readonly db: DbService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const req = context.switchToHttp().getRequest();
    const actorId = (req.user?.id as string | undefined) ?? null;

    const setActor = () =>
      this.db.client.execute(
        actorId
          ? `SELECT set_config('app.actor_user_id', '${actorId}', false)`
          : `SELECT set_config('app.actor_user_id', '', false)`,
      );
    const clearActor = () =>
      this.db.client.execute(`SELECT set_config('app.actor_user_id', '', false)`);

    // Fire-and-forget the initial set without blocking the request, then clear
    // when the response stream completes or errors.
    void setActor();
    return next.handle().pipe(
      finalize(() => {
        void clearActor();
      }),
    );
  }
}

/** Disable sync capture for a block that must not be mirrored (restore replay
 * writes are historical, not new events). Runs inside the caller's
 * transaction so the setting never leaks beyond it. The callback receives the
 * transaction client so its writes ride the same connection. */
export async function withSyncDisabled<T>(
  db: DbService,
  fn: (tx: DbService["client"]) => Promise<T>,
): Promise<T> {
  return db.client.transaction(async (tx) => {
    await tx.execute(`SELECT set_config('app.sync_disabled', 'true', true)`);
    const result = await fn(tx);
    return result;
  });
}