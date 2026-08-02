-- AlterTable
ALTER TABLE "fields" ADD COLUMN     "color" TEXT;

-- AlterTable
ALTER TABLE "financial_settings" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "color" TEXT;

-- AlterTable
ALTER TABLE "levels" ADD COLUMN     "color" TEXT;

-- AlterTable
ALTER TABLE "payroll_payments" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "professor_compensations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "professors" ADD COLUMN     "color" TEXT;

-- AlterTable
ALTER TABLE "receipt_counters" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "color" TEXT;
