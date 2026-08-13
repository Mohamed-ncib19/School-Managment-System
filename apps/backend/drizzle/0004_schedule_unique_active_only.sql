-- Restrict the schedule_entries uniqueness rules to *active* rules.
--
-- The three keys below exist to stop a group, a professor or a classroom being
-- booked twice into the same slot on the same start date. They were declared
-- over the whole table, which also made them apply to rules that had been
-- retired — and a retired rule describes a session that no longer happens.
--
-- The effect was that removing a session and putting it back, or moving one to
-- a different room on the same day, failed with a unique violation: the
-- archived row was still holding the slot. Since a group's timetable is edited
-- by reconciling it against what was submitted, that made the most ordinary
-- edit there is fail once a session had ever been changed.
--
-- Archived rows are history and are allowed to repeat; only live rules have to
-- be unique.

DROP INDEX IF EXISTS "schedule_entries_group_slot_from_key";--> statement-breakpoint
DROP INDEX IF EXISTS "schedule_entries_classroom_slot_from_key";--> statement-breakpoint
DROP INDEX IF EXISTS "schedule_entries_prof_slot_from_key";--> statement-breakpoint

CREATE UNIQUE INDEX "schedule_entries_group_slot_from_key"
  ON "schedule_entries" USING btree ("group_id", "time_slot_id", "effective_from")
  WHERE "is_active";--> statement-breakpoint

CREATE UNIQUE INDEX "schedule_entries_classroom_slot_from_key"
  ON "schedule_entries" USING btree ("classroom_id", "time_slot_id", "effective_from")
  WHERE "is_active";--> statement-breakpoint

CREATE UNIQUE INDEX "schedule_entries_prof_slot_from_key"
  ON "schedule_entries" USING btree ("prof_id", "time_slot_id", "effective_from")
  WHERE "is_active";
