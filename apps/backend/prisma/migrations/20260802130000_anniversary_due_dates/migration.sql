-- Monthly invoices are due on the enrolment anniversary — the day of the month
-- the student enrolled — not at the end of the billing month. A student
-- inscribed on the 15th pays on the 15th of every month: the first invoice
-- (the month of enrolment) falls due on the inscription date itself, "due soon"
-- opens two days before it, and it is plain "not paid" once the date passes.
--
-- This reverts the month-end due dates set by 20260802110000_month_end_due_dates
-- and re-derives the unsettled statuses against the new dates. Due dates are
-- clamped to the last day of the billed month for short months.

UPDATE "student_payments" sp
SET "due_date" = LEAST(
        DATE_TRUNC('month', TO_DATE(sp."period", 'YYYY-MM'))
          + (EXTRACT(DAY FROM s."enrollment_date")::int - 1) * INTERVAL '1 day',
        DATE_TRUNC('month', TO_DATE(sp."period", 'YYYY-MM'))
          + INTERVAL '1 month' - INTERVAL '1 day'
      )
FROM "students" s
WHERE s."id" = sp."student_id";

-- Re-derive unsettled statuses: due_soon only inside the two-day window before
-- the due date, plain not_paid outside it (also unwinds any stale overdue rows).
UPDATE "student_payments"
SET "status" = CASE
        WHEN "status" IN ('not_paid', 'due_soon', 'overdue')
          AND "due_date" >= CURRENT_DATE
          AND "due_date" <= CURRENT_DATE + INTERVAL '2 days'
        THEN 'due_soon'
        WHEN "status" IN ('not_paid', 'due_soon', 'overdue')
        THEN 'not_paid'
        ELSE "status"
      END;
