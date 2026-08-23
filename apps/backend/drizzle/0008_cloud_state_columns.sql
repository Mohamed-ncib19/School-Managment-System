ALTER TABLE "cloud_state" ADD COLUMN IF NOT EXISTS "wrapped_key" text;--> statement-breakpoint
ALTER TABLE "cloud_state" ADD COLUMN IF NOT EXISTS "wrap_salt" text;--> statement-breakpoint
ALTER TABLE "cloud_state" ADD COLUMN IF NOT EXISTS "schema_hash" text;--> statement-breakpoint
ALTER TABLE "sync_queue" ADD COLUMN IF NOT EXISTS "last_error" text;--> statement-breakpoint
ALTER TABLE "sync_queue" ADD COLUMN IF NOT EXISTS "processed_at" timestamp (3);
