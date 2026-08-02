-- Assignment-level fees: each enrollment has its own monthly fee, backfilled
-- from the student's single fee so nothing changes for existing students.
ALTER TABLE "student_assignments" ADD COLUMN "fee" DECIMAL(10,2) NOT NULL DEFAULT 0;
UPDATE "student_assignments" sa SET "fee" = s.monthly_fee FROM "students" s WHERE s.id = sa.student_id;

-- Invoices become per enrollment: every row names the group it covers, so a
-- student in two fields is billed twice. Existing invoices point at the
-- student's primary group, preserving their meaning.
ALTER TABLE "student_payments" ADD COLUMN "group_id" UUID;
UPDATE "student_payments" sp SET "group_id" = s.group_id FROM "students" s WHERE s.id = sp.student_id;
ALTER TABLE "student_payments" ALTER COLUMN "group_id" SET NOT NULL;

-- One invoice per student, group and period.
DROP INDEX "student_payments_student_id_period_key";
CREATE UNIQUE INDEX "student_payments_student_id_group_id_period_key" ON "student_payments"("student_id", "group_id", "period");
CREATE INDEX "student_payments_group_id_idx" ON "student_payments"("group_id");

-- A group's invoices are financial history; purging a group (hard delete) is an
-- explicit destructive act that removes them, so the FK is RESTRICT here and
-- the purge cleans up first.
ALTER TABLE "student_payments" ADD CONSTRAINT "student_payments_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
