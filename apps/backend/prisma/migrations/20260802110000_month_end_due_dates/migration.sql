-- Monthly invoices are due at the END of the payment month they bill, not on
-- the student's enrolment anniversary. A fresh invoice for the current month
-- therefore reads as plain "not paid" instead of "due soon" on day one.
-- (The generation code changed in billing.util.ts; this backfills existing rows.)
UPDATE "student_payments"
SET "due_date" = DATE_TRUNC('month', TO_DATE("period", 'YYYY-MM')) + INTERVAL '1 month' - INTERVAL '1 day'
WHERE "period" ~ '^[0-9]{4}-[0-9]{2}$';

-- Statuses are derived from due dates; one that moved forward must not leave an
-- invoice labelled "due soon" while its payment month has barely started.
UPDATE "student_payments"
SET "status" = 'not_paid'::"PaymentStatus"
WHERE "status" = 'due_soon'::"PaymentStatus"
  AND "due_date" > CURRENT_TIMESTAMP + INTERVAL '2 days';
