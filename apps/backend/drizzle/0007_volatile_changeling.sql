CREATE TABLE "backup_manifest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"kind" text NOT NULL,
	"covers_from_seq" bigint,
	"covers_to_seq" bigint,
	"uncompressed_sha256" text NOT NULL,
	"uncompressed_bytes" bigint NOT NULL,
	"stored_bytes" bigint NOT NULL,
	"format_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cloud_state" (
	"singleton" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"school_id" text NOT NULL,
	"instance_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"hostname" text NOT NULL,
	"setup_complete" boolean DEFAULT false NOT NULL,
	"verify_complete" boolean DEFAULT false NOT NULL,
	"recovery_phrase_hash" text,
	"kdf_salt" text,
	"quiet_hour" integer DEFAULT 3 NOT NULL,
	"drain_interval_seconds" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL,
	"last_manifest_at" timestamp (3),
	CONSTRAINT "cloud_state_singleton_check" CHECK (singleton = 'global'::text)
);
--> statement-breakpoint
CREATE TABLE "cloud_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver" text NOT NULL,
	"display_label" text NOT NULL,
	"config_ref" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"last_success_at" timestamp (3),
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restore_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" text NOT NULL,
	"snapshot_key" text NOT NULL,
	"applied_through_seq" bigint DEFAULT 0 NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_queue" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_table" text NOT NULL,
	"entity_id" text NOT NULL,
	"operation" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"occurred_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"actor_user_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"batch_id" uuid
);
--> statement-breakpoint
CREATE INDEX "backup_manifest_target_created_idx" ON "backup_manifest" USING btree ("target_id","created_at");--> statement-breakpoint
CREATE INDEX "backup_manifest_kind_seq_idx" ON "backup_manifest" USING btree ("kind","covers_to_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "restore_progress_job_key" ON "restore_progress" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "sync_queue_status_id_idx" ON "sync_queue" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "sync_queue_occurred_at_idx" ON "sync_queue" USING btree ("occurred_at");