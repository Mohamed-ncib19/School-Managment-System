CREATE TABLE "schedule_entry_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_entry_id" uuid NOT NULL,
	"occurrence_date" timestamp (3) NOT NULL,
	"exception_type" text NOT NULL,
	"new_date" timestamp (3),
	"new_time_slot_id" uuid,
	"new_classroom_id" uuid,
	"new_prof_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "schedule_entry_exceptions_type_check" CHECK (exception_type IN ('cancelled','moved','substitute_prof','room_change'))
);
--> statement-breakpoint
CREATE TABLE "working_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_of_week" integer,
	"label" text,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "working_hours_end_after_start_check" CHECK (end_time > start_time),
	CONSTRAINT "working_hours_day_range_check" CHECK ((day_of_week IS NULL) OR ((day_of_week >= 0) AND (day_of_week <= 6)))
);
--> statement-breakpoint
ALTER TABLE "classrooms" ADD COLUMN "building" text;--> statement-breakpoint
ALTER TABLE "schedule_entry_exceptions" ADD CONSTRAINT "schedule_entry_exceptions_schedule_entry_id_fkey" FOREIGN KEY ("schedule_entry_id") REFERENCES "public"."schedule_entries"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "schedule_entry_exceptions" ADD CONSTRAINT "schedule_entry_exceptions_new_time_slot_id_fkey" FOREIGN KEY ("new_time_slot_id") REFERENCES "public"."time_slots"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "schedule_entry_exceptions" ADD CONSTRAINT "schedule_entry_exceptions_new_classroom_id_fkey" FOREIGN KEY ("new_classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "schedule_entry_exceptions" ADD CONSTRAINT "schedule_entry_exceptions_new_prof_id_fkey" FOREIGN KEY ("new_prof_id") REFERENCES "public"."professors"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "schedule_entry_exceptions" ADD CONSTRAINT "schedule_entry_exceptions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_entry_exceptions_entry_date_key" ON "schedule_entry_exceptions" USING btree ("schedule_entry_id","occurrence_date");--> statement-breakpoint
CREATE INDEX "schedule_entry_exceptions_date_idx" ON "schedule_entry_exceptions" USING btree ("occurrence_date");--> statement-breakpoint
CREATE INDEX "schedule_entry_exceptions_type_idx" ON "schedule_entry_exceptions" USING btree ("exception_type");--> statement-breakpoint
CREATE INDEX "working_hours_day_idx" ON "working_hours" USING btree ("day_of_week");--> statement-breakpoint
CREATE INDEX "working_hours_active_idx" ON "working_hours" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "classrooms_building_room_key" ON "classrooms" USING btree ("building","room_number") WHERE "classrooms"."room_number" IS NOT NULL;