ALTER TABLE "whiteboards" DROP CONSTRAINT "whiteboards_schedule_entry_id_fkey";
--> statement-breakpoint
DROP INDEX "whiteboards_schedule_entry_id_idx";--> statement-breakpoint
ALTER TABLE "whiteboards" DROP COLUMN "schedule_entry_id";