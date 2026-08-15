CREATE TABLE "whiteboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text DEFAULT 'Nouveau tableau' NOT NULL,
	"scene" jsonb NOT NULL,
	"schedule_entry_id" uuid,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL,
	"last_edited_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
DROP INDEX "schedule_entries_group_slot_from_key";--> statement-breakpoint
DROP INDEX "schedule_entries_classroom_slot_from_key";--> statement-breakpoint
DROP INDEX "schedule_entries_prof_slot_from_key";--> statement-breakpoint
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_schedule_entry_id_fkey" FOREIGN KEY ("schedule_entry_id") REFERENCES "public"."schedule_entries"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "whiteboards_owner_id_idx" ON "whiteboards" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "whiteboards_schedule_entry_id_idx" ON "whiteboards" USING btree ("schedule_entry_id");--> statement-breakpoint
CREATE INDEX "whiteboards_updated_at_idx" ON "whiteboards" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_trgm_idx" ON "audit_logs" USING gin ("action" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_label_trgm_idx" ON "audit_logs" USING gin ("entity_label" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_label_trgm_idx" ON "audit_logs" USING gin ("actor_label" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "groups_name_trgm_idx" ON "groups" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "professors_full_name_trgm_idx" ON "professors" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "students_created_at_idx" ON "students" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "students_enrollment_date_idx" ON "students" USING btree ("enrollment_date");--> statement-breakpoint
CREATE INDEX "students_first_name_trgm_idx" ON "students" USING gin ("first_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "students_last_name_trgm_idx" ON "students" USING gin ("last_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "students_phone_trgm_idx" ON "students" USING gin ("phone" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "students_parent_phone_trgm_idx" ON "students" USING gin ("parent_phone" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "students_email_trgm_idx" ON "students" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "students_first_name_unaccent_trgm_idx" ON "students" USING gin ((translate(lower("first_name"), 'àâäçéèêëîïôöùûüÿ', 'aaaceeeeiioouuuy')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "students_last_name_unaccent_trgm_idx" ON "students" USING gin ((translate(lower("last_name"), 'àâäçéèêëîïôöùûüÿ', 'aaaceeeeiioouuuy')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "users_full_name_trgm_idx" ON "users" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_entries_group_slot_from_key" ON "schedule_entries" USING btree ("group_id","time_slot_id","effective_from") WHERE "schedule_entries"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_entries_classroom_slot_from_key" ON "schedule_entries" USING btree ("classroom_id","time_slot_id","effective_from") WHERE "schedule_entries"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_entries_prof_slot_from_key" ON "schedule_entries" USING btree ("prof_id","time_slot_id","effective_from") WHERE "schedule_entries"."is_active";