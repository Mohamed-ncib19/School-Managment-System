-- Removal of the "Unassigned" holding-pen placeholders.
-- New deletes must reassign every child (no leave-unassigned option).
-- Existing placeholder rows have no real children pointing at them
-- (verified) and are deleted so they disappear from archives and exports.
DELETE FROM "students" WHERE "is_system_placeholder" = true;
DELETE FROM "groups" WHERE "is_system_placeholder" = true;
DELETE FROM "professors" WHERE "is_system_placeholder" = true;
DELETE FROM "fields" WHERE "is_system_placeholder" = true;
DELETE FROM "levels" WHERE "is_system_placeholder" = true;
--> statement-breakpoint
ALTER TABLE "students" DROP COLUMN IF EXISTS "is_system_placeholder";--> statement-breakpoint
ALTER TABLE "groups" DROP COLUMN IF EXISTS "is_system_placeholder";--> statement-breakpoint
ALTER TABLE "professors" DROP COLUMN IF EXISTS "is_system_placeholder";--> statement-breakpoint
ALTER TABLE "fields" DROP COLUMN IF EXISTS "is_system_placeholder";--> statement-breakpoint
ALTER TABLE "levels" DROP COLUMN IF EXISTS "is_system_placeholder";
