-- Financial Management: turns the single-row payments table into a full ledger.
--
-- `student_payments` keeps its meaning exactly — one invoice per student per
-- month — and no row in it is deleted, re-keyed or re-priced here. What changes
-- is that money movement moves out into `payment_transactions`, so a month can
-- be settled in several instalments, refunded or corrected without the invoice
-- losing its history.
--
-- Everything already collected is backfilled into the ledger as one `payment`
-- transaction, apportioned at the academy's default split, so revenue and
-- payroll figures are correct from the moment this lands rather than starting
-- from zero.

-- New states. Both are additive: no existing row changes status here, and
-- neither value is *used* in this migration, which is what lets ADD VALUE share
-- a transaction with the statements below on PostgreSQL 12+.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'partially_paid';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'cancelled';

CREATE TYPE "TransactionType" AS ENUM ('payment', 'refund', 'correction');

CREATE TYPE "CompensationModel" AS ENUM (
  'percentage',
  'fixed_salary',
  'fixed_per_student',
  'fixed_per_group',
  'hybrid',
  'custom'
);

-- Academy-wide settings. The CHECK is what makes this a singleton: a second row
-- is rejected by the database, not merely discouraged by the service layer.
CREATE TABLE "financial_settings" (
    "singleton" TEXT NOT NULL DEFAULT 'global',
    "currency" TEXT NOT NULL DEFAULT 'TND',
    "currency_locale" TEXT NOT NULL DEFAULT 'fr-TN',
    "default_compensation_model" "CompensationModel" NOT NULL DEFAULT 'percentage',
    "default_professor_percentage" DECIMAL(5,2) NOT NULL DEFAULT 60,
    "default_fixed_amount" DECIMAL(10,2),
    "receipt_number_format" TEXT NOT NULL DEFAULT 'REC-{YYYY}-{SEQ}',
    "payroll_receipt_format" TEXT NOT NULL DEFAULT 'PAY-{YYYY}-{SEQ}',
    "due_soon_days" INTEGER NOT NULL DEFAULT 2,
    "late_grace_days" INTEGER NOT NULL DEFAULT 0,
    "late_fee_enabled" BOOLEAN NOT NULL DEFAULT false,
    "late_fee_amount" DECIMAL(10,2),
    "academic_year_start_month" INTEGER NOT NULL DEFAULT 9,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_settings_pkey" PRIMARY KEY ("singleton"),
    CONSTRAINT "financial_settings_singleton_check" CHECK ("singleton" = 'global'),
    CONSTRAINT "financial_settings_percentage_check"
      CHECK ("default_professor_percentage" >= 0 AND "default_professor_percentage" <= 100),
    CONSTRAINT "financial_settings_academic_month_check"
      CHECK ("academic_year_start_month" >= 1 AND "academic_year_start_month" <= 12)
);

-- Seeded here rather than left to the seed script: every service that prices a
-- payment reads this row, so the application must never boot without it.
INSERT INTO "financial_settings" ("singleton") VALUES ('global');

CREATE TABLE "receipt_counters" (
    "scope" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_counters_pkey" PRIMARY KEY ("scope")
);

CREATE TABLE "professor_compensations" (
    "id" UUID NOT NULL,
    "prof_id" UUID NOT NULL,
    "model" "CompensationModel" NOT NULL DEFAULT 'percentage',
    "percentage" DECIMAL(5,2),
    "fixed_amount" DECIMAL(10,2),
    "custom_formula" TEXT,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "professor_compensations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "professor_compensations_percentage_check"
      CHECK ("percentage" IS NULL OR ("percentage" >= 0 AND "percentage" <= 100))
);

CREATE UNIQUE INDEX "professor_compensations_prof_id_key" ON "professor_compensations"("prof_id");

ALTER TABLE "professor_compensations" ADD CONSTRAINT "professor_compensations_prof_id_fkey"
  FOREIGN KEY ("prof_id") REFERENCES "professors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "type" "TransactionType" NOT NULL DEFAULT 'payment',
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'cash',
    "receipt_number" TEXT,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by" UUID,
    "notes" TEXT,
    "reason" TEXT,
    "professor_share" DECIMAL(10,2) NOT NULL,
    "school_share" DECIMAL(10,2) NOT NULL,
    "compensation_model" "CompensationModel" NOT NULL,
    "compensation_snapshot" JSONB,
    "prof_id" UUID,
    "period" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id"),
    -- A zero-value movement is always a mistake and would silently pollute
    -- collection counts.
    CONSTRAINT "payment_transactions_amount_check" CHECK ("amount" <> 0),
    -- The split must always reconstitute the amount, whatever formula produced
    -- it. This is the invariant every revenue figure in the app depends on.
    CONSTRAINT "payment_transactions_split_check"
      CHECK ("professor_share" + "school_share" = "amount")
);

CREATE UNIQUE INDEX "payment_transactions_receipt_number_key" ON "payment_transactions"("receipt_number");
CREATE INDEX "payment_transactions_payment_id_idx" ON "payment_transactions"("payment_id");
CREATE INDEX "payment_transactions_prof_id_idx" ON "payment_transactions"("prof_id");
CREATE INDEX "payment_transactions_period_idx" ON "payment_transactions"("period");
CREATE INDEX "payment_transactions_paid_at_idx" ON "payment_transactions"("paid_at");
CREATE INDEX "payment_transactions_prof_id_period_idx" ON "payment_transactions"("prof_id", "period");
CREATE INDEX "payment_transactions_type_idx" ON "payment_transactions"("type");

-- Cascade from the invoice: deleting an invoice must not strand its ledger.
-- The professor link is RESTRICT-free (SET NULL) so archiving staff never
-- destroys the record of revenue they generated.
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "student_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_recorded_by_fkey"
  FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_prof_id_fkey"
  FOREIGN KEY ("prof_id") REFERENCES "professors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "payroll_payments" (
    "id" UUID NOT NULL,
    "prof_id" UUID NOT NULL,
    "period" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'cash',
    "receipt_number" TEXT,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "recorded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_payments_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "payroll_payments_receipt_number_key" ON "payroll_payments"("receipt_number");
CREATE INDEX "payroll_payments_prof_id_idx" ON "payroll_payments"("prof_id");
CREATE INDEX "payroll_payments_period_idx" ON "payroll_payments"("period");
CREATE INDEX "payroll_payments_paid_at_idx" ON "payroll_payments"("paid_at");
CREATE INDEX "payroll_payments_prof_id_period_idx" ON "payroll_payments"("prof_id", "period");

ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_prof_id_fkey"
  FOREIGN KEY ("prof_id") REFERENCES "professors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_recorded_by_fkey"
  FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Composite indexes for the dashboard's two hottest filters: "unpaid as of a
-- date" and "everything in a period bucketed by status".
CREATE INDEX "student_payments_status_due_date_idx" ON "student_payments"("status", "due_date");
CREATE INDEX "student_payments_period_status_idx" ON "student_payments"("period", "status");

-- ---------------------------------------------------------------------------
-- Backfill: every settled invoice becomes one ledger entry.
-- ---------------------------------------------------------------------------
--
-- Apportioned at the default 60/40 split, because that is the arrangement the
-- academy is declaring as of this migration and no per-professor override can
-- exist yet. `school_share` is derived by subtraction rather than by a second
-- rounding, so the split_check invariant holds exactly for every row.
--
-- Receipt numbers are issued in payment order within each year, matching the
-- format the application will go on to use, so the sequence has no gap or
-- collision when the first new receipt is issued.

INSERT INTO "payment_transactions" (
    "id", "payment_id", "type", "amount", "method", "receipt_number", "paid_at",
    "recorded_by", "notes", "professor_share", "school_share",
    "compensation_model", "compensation_snapshot", "prof_id", "period", "created_at"
)
SELECT
    gen_random_uuid(),
    b."id",
    'payment'::"TransactionType",
    b."amount",
    COALESCE(b."payment_method", 'cash'::"PaymentMethod"),
    'REC-' || b."year" || '-' || LPAD(b."seq"::TEXT, 4, '0'),
    b."paid_at",
    b."recorded_by",
    b."notes",
    b."prof_share",
    b."amount" - b."prof_share",
    'percentage'::"CompensationModel",
    jsonb_build_object(
      'model', 'percentage',
      'percentage', 60,
      'source', 'backfill',
      'note', 'Apportioned at the academy default when the financial module was introduced.'
    ),
    b."prof_id",
    b."period",
    CURRENT_TIMESTAMP
FROM (
    SELECT
        sp."id",
        sp."paid_amount" AS "amount",
        ROUND(sp."paid_amount" * 0.60, 2) AS "prof_share",
        COALESCE(sp."paid_at", sp."updated_at") AS "paid_at",
        sp."payment_method",
        sp."recorded_by",
        sp."notes",
        sp."period",
        g."prof_id",
        EXTRACT(YEAR FROM COALESCE(sp."paid_at", sp."updated_at"))::INT AS "year",
        ROW_NUMBER() OVER (
            PARTITION BY EXTRACT(YEAR FROM COALESCE(sp."paid_at", sp."updated_at"))::INT
            ORDER BY COALESCE(sp."paid_at", sp."updated_at"), sp."id"
        ) AS "seq"
    FROM "student_payments" sp
    JOIN "students" s ON s."id" = sp."student_id"
    JOIN "groups" g ON g."id" = s."group_id"
    WHERE sp."status" = 'paid'
      AND sp."paid_amount" IS NOT NULL
      AND sp."paid_amount" <> 0
) b;

-- Start each year's counter where the backfill left off.
INSERT INTO "receipt_counters" ("scope", "value")
SELECT 'payment:' || EXTRACT(YEAR FROM "paid_at")::INT, COUNT(*)::INT
FROM "payment_transactions"
GROUP BY EXTRACT(YEAR FROM "paid_at")::INT
ON CONFLICT ("scope") DO UPDATE SET "value" = EXCLUDED."value";
