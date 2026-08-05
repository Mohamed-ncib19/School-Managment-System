-- Redesigned monthly attendance sheet: session-based register (8 séances by
-- default), the field name and academic year are snapshotted on the sheet so a
-- reprint shows the exact context that was handed out.

ALTER TABLE "attendance_sheets"
  ADD COLUMN "field_name" TEXT,
  ADD COLUMN "academic_year" TEXT,
  ADD COLUMN "sessions" JSONB;
