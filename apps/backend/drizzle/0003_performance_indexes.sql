-- Performance indexes.
--
-- Two families, both addressing scans that are invisible on a small database
-- and unavoidable on a real one.
--
-- 1. Trigram (GIN) indexes for the `ILIKE '%term%'` searches. A leading
--    wildcard cannot use a btree index at all, so every search across
--    students, professors and the audit trail is a sequential scan today.
--
-- 2. Btree indexes on the columns the list endpoints actually ORDER BY.
--
-- Index selection is deliberately narrow on `audit_logs`: it is written on
-- every mutating request, and each GIN index is paid for on that write path.
-- Only the three columns the UI actually offers as free-text filters are
-- indexed; `entity_type` is low-cardinality (a handful of distinct values, so
-- a scan is cheaper than the index) and `ip_address` is not a search field.

CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- students ------------------------------------------------------------------
-- Plain-column trigram indexes serve `ILIKE '%x%'`: pg_trgm lowercases the
-- trigrams it stores, so the index is already case-insensitive.
CREATE INDEX IF NOT EXISTS "students_first_name_trgm_idx" ON "students" USING gin ("first_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "students_last_name_trgm_idx" ON "students" USING gin ("last_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "students_phone_trgm_idx" ON "students" USING gin ("phone" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "students_parent_phone_trgm_idx" ON "students" USING gin ("parent_phone" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "students_email_trgm_idx" ON "students" USING gin ("email" gin_trgm_ops);--> statement-breakpoint

-- The payments search does not compare the column: it compares
-- `translate(lower(name), <diacritics>, <plain>)` so that "méité" matches
-- "meite". A plain-column index cannot serve that expression, so the
-- expression itself is indexed. Both `lower` and `translate` are IMMUTABLE,
-- which is what makes this legal.
CREATE INDEX IF NOT EXISTS "students_first_name_unaccent_trgm_idx" ON "students"
  USING gin ((translate(lower("first_name"), 'àâäçéèêëîïôöùûüÿ', 'aaaceeeeiioouuuy')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "students_last_name_unaccent_trgm_idx" ON "students"
  USING gin ((translate(lower("last_name"), 'àâäçéèêëîïôöùûüÿ', 'aaaceeeeiioouuuy')) gin_trgm_ops);--> statement-breakpoint

-- Sort keys for the list endpoints. `created_at` orders the main student list,
-- `enrollment_date` the dashboard's recent-enrolments widget; both force a
-- full sort today.
--
-- Declared ascending even though both are read newest-first: Postgres scans a
-- btree backwards just as cheaply, and a plain ascending index is what matches
-- `ORDER BY col DESC`. Declaring `DESC NULLS LAST` instead would *not* match —
-- `DESC` implies NULLS FIRST — and the planner would silently fall back to a
-- full sort, which is exactly the cost this index exists to remove.
CREATE INDEX IF NOT EXISTS "students_created_at_idx" ON "students" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "students_enrollment_date_idx" ON "students" USING btree ("enrollment_date");--> statement-breakpoint

-- professors ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "professors_full_name_trgm_idx" ON "professors" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint

-- groups --------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "groups_name_trgm_idx" ON "groups" USING gin ("name" gin_trgm_ops);--> statement-breakpoint

-- audit_logs ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "audit_logs_action_trgm_idx" ON "audit_logs" USING gin ("action" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_entity_label_trgm_idx" ON "audit_logs" USING gin ("entity_label" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_actor_label_trgm_idx" ON "audit_logs" USING gin ("actor_label" gin_trgm_ops);--> statement-breakpoint

-- users ---------------------------------------------------------------------
-- The audit search resolves actor names through a separate scan of `users`.
CREATE INDEX IF NOT EXISTS "users_full_name_trgm_idx" ON "users" USING gin ("full_name" gin_trgm_ops);
