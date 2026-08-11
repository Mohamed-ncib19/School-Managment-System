CREATE TYPE "public"."CompensationModel" AS ENUM('percentage', 'fixed_salary', 'fixed_per_student', 'fixed_per_group', 'hybrid', 'custom');--> statement-breakpoint
CREATE TYPE "public"."PaymentStatus" AS ENUM('not_paid', 'due_soon', 'overdue', 'paid', 'partially_paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."PaymentMethod" AS ENUM('cash');--> statement-breakpoint
CREATE TYPE "public"."PayrollDocumentType" AS ENUM('professor_receipt', 'school_settlement');--> statement-breakpoint
CREATE TYPE "public"."StudentStatus" AS ENUM('active', 'paused', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."TransactionType" AS ENUM('payment', 'refund', 'correction');--> statement-breakpoint
CREATE TYPE "public"."UserRole" AS ENUM('super_admin');--> statement-breakpoint
CREATE TABLE "attendance_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"schedule" text,
	"teacher_id" uuid,
	"teacher_name" text NOT NULL,
	"level_name" text NOT NULL,
	"group_name" text NOT NULL,
	"students" jsonb NOT NULL,
	"generated_by" uuid,
	"generated_at" timestamp (6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"field_name" text,
	"academic_year" text,
	"sessions" jsonb
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"meta" jsonb,
	"created_at" timestamp (6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"actor_label" text,
	"actor_role" text,
	"entity_label" text,
	"prev_values" jsonb,
	"new_values" jsonb,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"level_id" uuid NOT NULL,
	"color" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_settings" (
	"singleton" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"currency" text DEFAULT 'TND' NOT NULL,
	"currency_locale" text DEFAULT 'fr-TN' NOT NULL,
	"default_compensation_model" "CompensationModel" DEFAULT 'percentage' NOT NULL,
	"default_professor_percentage" numeric(5, 2) DEFAULT '60' NOT NULL,
	"default_fixed_amount" numeric(10, 2),
	"receipt_number_format" text DEFAULT 'REC-{YYYY}-{SEQ}' NOT NULL,
	"payroll_receipt_format" text DEFAULT 'PAY-{YYYY}-{SEQ}' NOT NULL,
	"due_soon_days" integer DEFAULT 2 NOT NULL,
	"late_grace_days" integer DEFAULT 0 NOT NULL,
	"late_fee_enabled" boolean DEFAULT false NOT NULL,
	"late_fee_amount" numeric(10, 2),
	"academic_year_start_month" integer DEFAULT 9 NOT NULL,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL,
	"academy_name" text DEFAULT 'IQ Academy' NOT NULL,
	"academy_address" text DEFAULT '' NOT NULL,
	"academy_phone" text DEFAULT '' NOT NULL,
	"settlement_receipt_format" text DEFAULT 'SET-{YYYY}-{SEQ}' NOT NULL,
	"logo_path" text,
	CONSTRAINT "financial_settings_singleton_check" CHECK (singleton = 'global'::text),
	CONSTRAINT "financial_settings_percentage_check" CHECK ((default_professor_percentage >= (0)::numeric) AND (default_professor_percentage <= (100)::numeric)),
	CONSTRAINT "financial_settings_academic_month_check" CHECK ((academic_year_start_month >= 1) AND (academic_year_start_month <= 12))
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"capacity" integer,
	"schedule_notes" text,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"prof_id" uuid NOT NULL,
	"color" text
);
--> statement-breakpoint
CREATE TABLE "hierarchy_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"entityOrder" jsonb NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"color" text
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"type" "TransactionType" DEFAULT 'payment' NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"method" "PaymentMethod" DEFAULT 'cash' NOT NULL,
	"receipt_number" text,
	"paid_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"recorded_by" uuid,
	"notes" text,
	"reason" text,
	"professor_share" numeric(10, 2) NOT NULL,
	"school_share" numeric(10, 2) NOT NULL,
	"compensation_model" "CompensationModel" NOT NULL,
	"compensation_snapshot" jsonb,
	"prof_id" uuid,
	"period" text NOT NULL,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "payment_transactions_amount_check" CHECK (amount <> (0)::numeric),
	CONSTRAINT "payment_transactions_split_check" CHECK ((professor_share + school_share) = amount)
);
--> statement-breakpoint
CREATE TABLE "payroll_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_id" uuid NOT NULL,
	"type" "PayrollDocumentType" NOT NULL,
	"document_no" text NOT NULL,
	"title" text NOT NULL,
	"period" text,
	"generated_by" uuid,
	"generated_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prof_id" uuid NOT NULL,
	"period" text,
	"amount" numeric(10, 2) NOT NULL,
	"method" "PaymentMethod" DEFAULT 'cash' NOT NULL,
	"receipt_number" text,
	"paid_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"notes" text,
	"recorded_by" uuid,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_payments_amount_check" CHECK (amount > (0)::numeric)
);
--> statement-breakpoint
CREATE TABLE "professor_compensations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prof_id" uuid NOT NULL,
	"model" "CompensationModel" DEFAULT 'percentage' NOT NULL,
	"percentage" numeric(5, 2),
	"fixed_amount" numeric(10, 2),
	"custom_formula" text,
	"effective_from" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"notes" text,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "professor_compensations_percentage_check" CHECK ((percentage IS NULL) OR ((percentage >= (0)::numeric) AND (percentage <= (100)::numeric)))
);
--> statement-breakpoint
CREATE TABLE "professors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"user_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"color" text
);
--> statement-breakpoint
CREATE TABLE "receipt_counters" (
	"scope" text PRIMARY KEY NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"fee" numeric(10, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"period" text NOT NULL,
	"amount_due" numeric(10, 2) NOT NULL,
	"due_date" timestamp (3) NOT NULL,
	"status" "PaymentStatus" DEFAULT 'not_paid' NOT NULL,
	"paid_amount" numeric(10, 2),
	"paid_at" timestamp (3),
	"recorded_by" uuid,
	"payment_method" "PaymentMethod",
	"notes" text,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL,
	"group_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text NOT NULL,
	"parent_phone" text,
	"email" text,
	"enrollment_date" timestamp (3) NOT NULL,
	"monthly_fee" numeric(10, 2) NOT NULL,
	"status" "StudentStatus" DEFAULT 'active' NOT NULL,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"color" text
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"singleton" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"system_name" text DEFAULT 'IQ Academy' NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL,
	"support_email" text,
	"support_phone" text,
	"support_whatsapp" text,
	CONSTRAINT "system_settings_singleton_check" CHECK (singleton = 'global'::text)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "UserRole" DEFAULT 'super_admin' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL,
	"reset_token" text,
	"reset_token_expires" timestamp (3)
);
--> statement-breakpoint
ALTER TABLE "attendance_sheets" ADD CONSTRAINT "attendance_sheets_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "public"."levels"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_prof_id_fkey" FOREIGN KEY ("prof_id") REFERENCES "public"."professors"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."student_payments"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_prof_id_fkey" FOREIGN KEY ("prof_id") REFERENCES "public"."professors"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payroll_documents" ADD CONSTRAINT "payroll_documents_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "public"."payroll_payments"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payroll_documents" ADD CONSTRAINT "payroll_documents_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_prof_id_fkey" FOREIGN KEY ("prof_id") REFERENCES "public"."professors"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "professor_compensations" ADD CONSTRAINT "professor_compensations_prof_id_fkey" FOREIGN KEY ("prof_id") REFERENCES "public"."professors"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "professors" ADD CONSTRAINT "professors_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "public"."fields"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "professors" ADD CONSTRAINT "professors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "student_assignments" ADD CONSTRAINT "student_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "student_assignments" ADD CONSTRAINT "student_assignments_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "student_payments" ADD CONSTRAINT "student_payments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "student_payments" ADD CONSTRAINT "student_payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "student_payments" ADD CONSTRAINT "student_payments_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "attendance_sheets_generated_at_idx" ON "attendance_sheets" USING btree ("generated_at");--> statement-breakpoint
CREATE INDEX "attendance_sheets_group_id_idx" ON "attendance_sheets" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "fields_created_by_idx" ON "fields" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "fields_is_active_idx" ON "fields" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "fields_level_id_idx" ON "fields" USING btree ("level_id");--> statement-breakpoint
CREATE INDEX "groups_prof_id_idx" ON "groups" USING btree ("prof_id");--> statement-breakpoint
CREATE INDEX "payment_transactions_paid_at_idx" ON "payment_transactions" USING btree ("paid_at");--> statement-breakpoint
CREATE INDEX "payment_transactions_payment_id_idx" ON "payment_transactions" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_transactions_period_idx" ON "payment_transactions" USING btree ("period");--> statement-breakpoint
CREATE INDEX "payment_transactions_prof_id_idx" ON "payment_transactions" USING btree ("prof_id");--> statement-breakpoint
CREATE INDEX "payment_transactions_prof_id_period_idx" ON "payment_transactions" USING btree ("prof_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_transactions_receipt_number_key" ON "payment_transactions" USING btree ("receipt_number");--> statement-breakpoint
CREATE INDEX "payment_transactions_type_idx" ON "payment_transactions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "payroll_documents_payout_id_idx" ON "payroll_documents" USING btree ("payout_id");--> statement-breakpoint
CREATE INDEX "payroll_documents_period_idx" ON "payroll_documents" USING btree ("period");--> statement-breakpoint
CREATE INDEX "payroll_payments_paid_at_idx" ON "payroll_payments" USING btree ("paid_at");--> statement-breakpoint
CREATE INDEX "payroll_payments_period_idx" ON "payroll_payments" USING btree ("period");--> statement-breakpoint
CREATE INDEX "payroll_payments_prof_id_idx" ON "payroll_payments" USING btree ("prof_id");--> statement-breakpoint
CREATE INDEX "payroll_payments_prof_id_period_idx" ON "payroll_payments" USING btree ("prof_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_payments_receipt_number_key" ON "payroll_payments" USING btree ("receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "professor_compensations_prof_id_key" ON "professor_compensations" USING btree ("prof_id");--> statement-breakpoint
CREATE INDEX "professors_field_id_idx" ON "professors" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "professors_is_active_idx" ON "professors" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "student_assignments_group_id_idx" ON "student_assignments" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_assignments_student_id_group_id_key" ON "student_assignments" USING btree ("student_id","group_id");--> statement-breakpoint
CREATE INDEX "student_payments_due_date_idx" ON "student_payments" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "student_payments_group_id_idx" ON "student_payments" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "student_payments_period_idx" ON "student_payments" USING btree ("period");--> statement-breakpoint
CREATE INDEX "student_payments_period_status_idx" ON "student_payments" USING btree ("period","status");--> statement-breakpoint
CREATE INDEX "student_payments_status_due_date_idx" ON "student_payments" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "student_payments_status_idx" ON "student_payments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "student_payments_student_id_group_id_period_key" ON "student_payments" USING btree ("student_id","group_id","period");--> statement-breakpoint
CREATE INDEX "students_group_id_idx" ON "students" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "students_last_name_first_name_idx" ON "students" USING btree ("last_name","first_name");--> statement-breakpoint
CREATE INDEX "students_status_idx" ON "students" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");