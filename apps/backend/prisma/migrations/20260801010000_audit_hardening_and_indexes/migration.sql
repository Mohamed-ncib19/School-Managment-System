-- Audit trail hardening + missing foreign-key indexes.
--
-- Every statement here is additive or widening. No table is dropped, no column
-- is removed, and no row is deleted or rewritten destructively.

-- ---------------------------------------------------------------------------
-- 1. audit_logs: allow events that have no actor and/or no entity.
--
-- A failed login has no authenticated actor, and logout / settings changes have
-- no entity row. Both columns were NOT NULL, so the service passed the literal
-- strings 'system' and 'unknown' into uuid columns; Postgres rejected them and
-- the insert threw, which turned every failed login into an HTTP 500 and meant
-- no failed login was ever recorded.
-- ---------------------------------------------------------------------------
ALTER TABLE "audit_logs" ALTER COLUMN "actor_user_id" DROP NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "entity_id" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. audit_logs: richer, queryable record of each action.
-- ---------------------------------------------------------------------------
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actor_label"  TEXT;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actor_role"   TEXT;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "entity_label" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "prev_values"  JSONB;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "new_values"   JSONB;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "ip_address"   TEXT;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "user_agent"   TEXT;

-- ---------------------------------------------------------------------------
-- 3. audit_logs.created_at: timestamp -> timestamptz.
--
-- The column was `timestamp without time zone` holding UTC instants, while the
-- server clock is Africa/Lagos (UTC+1). Anything comparing the column against
-- now() / CURRENT_DATE in SQL - reports, retention jobs, a date-range filter -
-- silently drifted by the UTC offset. Existing values ARE UTC, so tagging them
-- with 'UTC' preserves every stored instant exactly.
-- ---------------------------------------------------------------------------
ALTER TABLE "audit_logs"
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC';

-- ---------------------------------------------------------------------------
-- 4. audit_logs.actor: Cascade -> SetNull.
--
-- With ON DELETE CASCADE, removing a user deleted that user's entire audit
-- history - the exact records an audit trail exists to preserve.
-- ---------------------------------------------------------------------------
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_actor_user_id_fkey";
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. Indexes for audit filtering.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx"            ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- ---------------------------------------------------------------------------
-- 6. Missing foreign-key indexes.
--
-- Postgres does not index foreign keys automatically. Every hierarchy join
-- (field -> professor -> level -> group -> student) and every "students in this
-- group" lookup was a sequential scan.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "fields_created_by_idx"   ON "fields"("created_by");
CREATE INDEX IF NOT EXISTS "professors_field_id_idx" ON "professors"("field_id");
CREATE INDEX IF NOT EXISTS "professors_is_active_idx" ON "professors"("is_active");
CREATE INDEX IF NOT EXISTS "levels_prof_id_idx"      ON "levels"("prof_id");
CREATE INDEX IF NOT EXISTS "groups_level_id_idx"     ON "groups"("level_id");
CREATE INDEX IF NOT EXISTS "students_group_id_idx"   ON "students"("group_id");
CREATE INDEX IF NOT EXISTS "students_status_idx"     ON "students"("status");

-- Name searches and the default roster ordering.
CREATE INDEX IF NOT EXISTS "students_last_name_first_name_idx"
  ON "students"("last_name", "first_name");
