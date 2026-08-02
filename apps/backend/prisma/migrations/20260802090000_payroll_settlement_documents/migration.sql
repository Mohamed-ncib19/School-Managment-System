-- Payroll settlement documents: the two printable A4 papers generated with
-- every payroll payment — the professor's payment receipt and the school's
-- internal settlement report.
--
-- `payroll_documents.data` is a frozen JSON snapshot of every figure the
-- document was rendered from, so reprinting later shows what was settled that
-- day, never a recomputation under a formula that changed since. Deleting a
-- payout (correcting a keying error) takes its documents with it.

CREATE TYPE "PayrollDocumentType" AS ENUM ('professor_receipt', 'school_settlement');

CREATE TABLE "payroll_documents" (
  "id"           UUID NOT NULL,
  "payout_id"    UUID NOT NULL,
  "type"         "PayrollDocumentType" NOT NULL,
  "document_no"  TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "period"       TEXT,
  "generated_by" UUID,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "data"         JSONB NOT NULL,
  CONSTRAINT "payroll_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payroll_documents_payout_id_idx" ON "payroll_documents"("payout_id");
CREATE INDEX "payroll_documents_period_idx" ON "payroll_documents"("period");

ALTER TABLE "payroll_documents"
  ADD CONSTRAINT "payroll_documents_payout_id_fkey" FOREIGN KEY ("payout_id")
    REFERENCES "payroll_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payroll_documents"
  ADD CONSTRAINT "payroll_documents_generated_by_fkey" FOREIGN KEY ("generated_by")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Academy identity printed on the documents (and available to any future
-- printed paper). Plain text columns, no foreign model — one academy, one row.
ALTER TABLE "financial_settings"
  ADD COLUMN "academy_name" TEXT NOT NULL DEFAULT 'IQ Academy',
  ADD COLUMN "academy_address" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "academy_phone" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "settlement_receipt_format" TEXT NOT NULL DEFAULT 'SET-{YYYY}-{SEQ}';
