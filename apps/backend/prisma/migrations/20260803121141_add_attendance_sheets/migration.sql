-- CreateTable
CREATE TABLE "attendance_sheets" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "schedule" TEXT,
    "teacher_id" UUID,
    "teacher_name" TEXT NOT NULL,
    "level_name" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "students" JSONB NOT NULL,
    "generated_by" UUID,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_sheets_group_id_idx" ON "attendance_sheets"("group_id");

-- CreateIndex
CREATE INDEX "attendance_sheets_generated_at_idx" ON "attendance_sheets"("generated_at");

-- AddForeignKey
ALTER TABLE "attendance_sheets" ADD CONSTRAINT "attendance_sheets_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
