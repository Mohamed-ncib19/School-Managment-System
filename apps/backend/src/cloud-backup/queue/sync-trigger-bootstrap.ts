import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { DbService } from "../../db/db.service";

/**
 * Database-trigger capture for the sync queue.
 *
 * Every write to a synced business table is captured by an AFTER trigger that
 * inserts a row into `sync_queue` in the SAME transaction as the write. This
 * is what makes it impossible for application code to write to a synced table
 * without producing a queue row: there is no repository layer to intercept
 * (services call Drizzle directly, the Excel importer and the restore path run
 * raw SQL / pg_restore), so the database itself is the only choke point that
 * covers every write path.
 *
 * The triggers are created idempotently at boot: `CREATE OR REPLACE FUNCTION`
 * plus `DROP TRIGGER IF EXISTS` / `CREATE TRIGGER` per table. This works on
 * every install regardless of how the schema got there — `drizzle-kit push`
 * creates the tables, and this bootstrap creates the triggers on top — and
 * re-runs safely after a restore (where the triggers may have been dropped
 * with the old schema).
 *
 * Actor attribution: an interceptor sets `app.actor_user_id` (a session-level
 * `set_config`) for the lifetime of each request; the trigger reads it via
 * `current_setting`. The restore/seed/import paths set `app.sync_disabled` (or
 * simply never set the actor) so their writes are attributed to the system.
 */

/** Business tables mirrored to the cloud. Adding one is a conscious act.
 * Everything else — infra, settings, the queue itself — is structurally
 * excluded. */
export const SYNCED_TABLES: readonly string[] = [
  "students",
  "student_payments",
  "payment_transactions",
  "professors",
  "fields",
  "levels",
  "groups",
  "student_assignments",
  "classrooms",
  "time_slots",
  "schedule_entries",
  "student_schedule_exceptions",
  "schedule_entry_exceptions",
  "working_hours",
  "professor_compensations",
  "payroll_payments",
  "payroll_documents",
  "attendance_sheets",
  "whiteboards",
] as const;

const FUNCTION_NAME = "iq_sync_capture";

const FUNCTION_BODY = `
CREATE OR REPLACE FUNCTION public.${FUNCTION_NAME}()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  actor text;
  sync_disabled text;
  row_payload jsonb;
  row_id text;
BEGIN
  sync_disabled := NULLIF(current_setting('app.sync_disabled', true), '');
  IF sync_disabled IS NOT NULL AND sync_disabled = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  actor := NULLIF(current_setting('app.actor_user_id', true), '');

  IF TG_OP = 'DELETE' THEN
    row_payload := to_jsonb(OLD);
    row_id := coalesce(row_payload->>'id', row_payload->>'scope', row_payload->>'singleton');
  ELSE
    row_payload := to_jsonb(NEW);
    row_id := coalesce(row_payload->>'id', row_payload->>'scope', row_payload->>'singleton');
  END IF;

  INSERT INTO public.sync_queue (
    entity_table, entity_id, operation, payload_json, occurred_at, actor_user_id
  ) VALUES (
    TG_TABLE_NAME,
    row_id,
    lower(TG_OP),
    row_payload,
    now(),
    NULLIF(actor, '')::uuid
  );

  RETURN COALESCE(NEW, OLD);
END;
$fn$;
`;

@Injectable()
export class SyncTriggerBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(SyncTriggerBootstrap.name);

  constructor(private readonly db: DbService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.db.client.execute(FUNCTION_BODY);
      for (const table of SYNCED_TABLES) {
        const triggerName = `iq_sync_${table}`;
        await this.db.client.execute(
          `DROP TRIGGER IF EXISTS ${triggerName} ON public.${table}`,
        );
        await this.db.client.execute(
          `CREATE TRIGGER ${triggerName}
           AFTER INSERT OR UPDATE OR DELETE ON public.${table}
           FOR EACH ROW EXECUTE FUNCTION public.${FUNCTION_NAME}()`,
        );
      }
      this.logger.log(
        `Sync capture triggers ready on ${SYNCED_TABLES.length} tables (${SYNCED_TABLES.join(", ")})`,
      );
    } catch (err) {
      // A failure here must be loud: if the queue is not being captured, the
      // whole disaster-recovery guarantee silently evaporates.
      this.logger.error(
        `Failed to install sync capture triggers — cloud backup will not capture changes. ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}