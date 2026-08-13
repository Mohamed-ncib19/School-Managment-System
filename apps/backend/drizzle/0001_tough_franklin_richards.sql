CREATE TABLE "classrooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"floor" text,
	"room_number" text,
	"capacity" integer,
	"equipment" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"color" text,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"time_slot_id" uuid NOT NULL,
	"classroom_id" uuid,
	"prof_id" uuid NOT NULL,
	"subject" text,
	"notes" text,
	"effective_from" timestamp (3) NOT NULL,
	"effective_until" timestamp (3),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_entries_until_after_from_check" CHECK (effective_until IS NULL OR effective_until >= effective_from)
);
--> statement-breakpoint
CREATE TABLE "student_schedule_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"schedule_entry_id" uuid NOT NULL,
	"exception_type" text NOT NULL,
	"exception_date" timestamp (3) NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "student_schedule_exceptions_type_check" CHECK (exception_type IN ('substitute','cancelled','makeup'))
);
--> statement-breakpoint
CREATE TABLE "time_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "time_slots_end_after_start_check" CHECK (end_time > start_time)
);
--> statement-breakpoint
ALTER TABLE "fields" ADD COLUMN "archived_at" timestamp (3);--> statement-breakpoint
ALTER TABLE "fields" ADD COLUMN "archived_because_parent_id" uuid;--> statement-breakpoint
ALTER TABLE "fields" ADD COLUMN "is_system_placeholder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "archived_at" timestamp (3);--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "archived_because_parent_id" uuid;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "is_system_placeholder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "levels" ADD COLUMN "archived_at" timestamp (3);--> statement-breakpoint
ALTER TABLE "levels" ADD COLUMN "is_system_placeholder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "professors" ADD COLUMN "archived_at" timestamp (3);--> statement-breakpoint
ALTER TABLE "professors" ADD COLUMN "archived_because_parent_id" uuid;--> statement-breakpoint
ALTER TABLE "professors" ADD COLUMN "is_system_placeholder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "archived_at" timestamp (3);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "archived_because_parent_id" uuid;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "is_system_placeholder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_time_slot_id_fkey" FOREIGN KEY ("time_slot_id") REFERENCES "public"."time_slots"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "schedule_entries" ADD CONSTRAINT "schedule_entries_prof_id_fkey" FOREIGN KEY ("prof_id") REFERENCES "public"."professors"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "student_schedule_exceptions" ADD CONSTRAINT "student_schedule_exceptions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "student_schedule_exceptions" ADD CONSTRAINT "student_schedule_exceptions_schedule_entry_id_fkey" FOREIGN KEY ("schedule_entry_id") REFERENCES "public"."schedule_entries"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "student_schedule_exceptions" ADD CONSTRAINT "student_schedule_exceptions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "classrooms_is_active_idx" ON "classrooms" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "classrooms_room_idx" ON "classrooms" USING btree ("room_number");--> statement-breakpoint
CREATE INDEX "schedule_entries_group_id_idx" ON "schedule_entries" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "schedule_entries_prof_id_idx" ON "schedule_entries" USING btree ("prof_id");--> statement-breakpoint
CREATE INDEX "schedule_entries_classroom_id_idx" ON "schedule_entries" USING btree ("classroom_id");--> statement-breakpoint
CREATE INDEX "schedule_entries_time_slot_id_idx" ON "schedule_entries" USING btree ("time_slot_id");--> statement-breakpoint
CREATE INDEX "schedule_entries_active_from_idx" ON "schedule_entries" USING btree ("is_active","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_entries_group_slot_from_key" ON "schedule_entries" USING btree ("group_id","time_slot_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_entries_classroom_slot_from_key" ON "schedule_entries" USING btree ("classroom_id","time_slot_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_entries_prof_slot_from_key" ON "schedule_entries" USING btree ("prof_id","time_slot_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "student_schedule_exceptions_student_entry_date_key" ON "student_schedule_exceptions" USING btree ("student_id","schedule_entry_id","exception_date");--> statement-breakpoint
CREATE UNIQUE INDEX "time_slots_day_start_end_key" ON "time_slots" USING btree ("day_of_week","start_time","end_time");--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_archived_because_parent_id_fkey" FOREIGN KEY ("archived_because_parent_id") REFERENCES "public"."levels"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_archived_because_parent_id_fkey" FOREIGN KEY ("archived_because_parent_id") REFERENCES "public"."professors"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "professors" ADD CONSTRAINT "professors_archived_because_parent_id_fkey" FOREIGN KEY ("archived_because_parent_id") REFERENCES "public"."fields"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_archived_because_parent_id_fkey" FOREIGN KEY ("archived_because_parent_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE cascade;