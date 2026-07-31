import { PrismaClient, PaymentStatus, StudentStatus } from "@prisma/client";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

/**
 * Fills the database with a realistic demo hierarchy so the UI can be judged
 * and query performance measured against something other than empty tables.
 *
 *   pnpm run db:seed:demo            add the demo data (idempotent-ish)
 *   pnpm run db:seed:demo -- --reset wipe ALL hierarchy data first
 *
 * `--reset` deletes every field/professor/level/group/student/payment, not just
 * the rows this script wrote. It leaves users and audit logs alone.
 */

// Deterministic PRNG so repeated runs produce the same dataset.
let seed = 20260730;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

const FIELDS = [
  { name: "Mathematics", description: "Algebra, analysis and geometry tracks" },
  { name: "Physics", description: "Mechanics, electricity and modern physics" },
  { name: "Computer Science", description: "Programming, algorithms and databases" },
] as const;

const PROFESSORS: Record<string, readonly string[]> = {
  Mathematics: ["Amina Belkacem", "Youcef Haddad"],
  Physics: ["Karim Benali", "Sofia Meziane"],
  "Computer Science": ["Nadia Cherif", "Reda Boumediene"],
};

const LEVEL_NAMES = ["Beginner", "Intermediate", "Advanced"] as const;
const GROUP_SUFFIX = ["A", "B", "C"] as const;

const FIRST_NAMES = [
  "Yasmine", "Mehdi", "Lina", "Anis", "Sarah", "Bilal", "Imane", "Walid",
  "Nour", "Adel", "Rania", "Sami", "Hiba", "Zaki", "Meriem", "Riad",
] as const;
const LAST_NAMES = [
  "Bouzid", "Khelifi", "Saidi", "Mansouri", "Ferhat", "Larbi", "Aissaoui",
  "Zerrouki", "Belhadj", "Toumi", "Ouali", "Djebbar",
] as const;

/** `YYYY-MM` for `monthsAgo` months before the current month. */
function periodOf(monthsAgo: number) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  return { period: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, year: d.getFullYear(), month: d.getMonth() };
}

async function reset() {
  // FK order: payments -> students -> groups -> levels -> professors -> fields.
  await prisma.student_payments.deleteMany({});
  await prisma.students.deleteMany({});
  await prisma.groups.deleteMany({});
  await prisma.levels.deleteMany({});
  await prisma.professors.deleteMany({});
  await prisma.fields.deleteMany({});
  console.log("  reset: hierarchy tables cleared");
}

async function main() {
  const shouldReset = process.argv.includes("--reset");

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@iqacademy.com";
  const admin = await prisma.users.findUnique({ where: { email: adminEmail } });
  if (!admin) {
    throw new Error(`Admin ${adminEmail} not found — run "pnpm run db:seed" first.`);
  }

  if (shouldReset) await reset();

  const existing = await prisma.fields.count();
  if (existing > 0 && !shouldReset) {
    console.log(`Skipped: ${existing} field(s) already exist. Re-run with --reset to rebuild.`);
    return;
  }

  const fieldRows: any[] = [];
  const profRows: any[] = [];
  const levelRows: any[] = [];
  const groupRows: any[] = [];
  const studentRows: any[] = [];
  const paymentRows: any[] = [];

  for (const field of FIELDS) {
    const fieldId = randomUUID();
    fieldRows.push({ id: fieldId, name: field.name, description: field.description, created_by: admin.id });

    for (const profName of PROFESSORS[field.name]) {
      const profId = randomUUID();
      profRows.push({
        id: profId,
        field_id: fieldId,
        full_name: profName,
        phone: `05${between(10, 99)}${between(100000, 999999)}`,
        email: `${profName.toLowerCase().replace(/\s+/g, ".")}@iqacademy.com`,
        is_active: true,
      });

      // 1-2 levels per professor.
      for (const levelName of LEVEL_NAMES.slice(0, between(1, 2))) {
        const levelId = randomUUID();
        levelRows.push({ id: levelId, prof_id: profId, name: levelName });

        // 1-2 groups per level.
        for (const suffix of GROUP_SUFFIX.slice(0, between(1, 2))) {
          const groupId = randomUUID();
          groupRows.push({
            id: groupId,
            level_id: levelId,
            name: `${levelName} ${suffix}`,
            capacity: between(12, 20),
            schedule_notes: pick(["Mon/Wed 17:00", "Tue/Thu 18:30", "Sat 09:00", "Sun 14:00"]),
          });

          // 5-9 students per group.
          const count = between(5, 9);
          for (let i = 0; i < count; i++) {
            const studentId = randomUUID();
            const enrolledMonthsAgo = between(1, 10);
            const enrollment = new Date();
            enrollment.setMonth(enrollment.getMonth() - enrolledMonthsAgo);
            enrollment.setDate(between(1, 28));
            const monthlyFee = between(6, 18) * 25; // 150 - 450

            studentRows.push({
              id: studentId,
              group_id: groupId,
              first_name: pick(FIRST_NAMES),
              last_name: pick(LAST_NAMES),
              phone: `06${between(10, 99)}${between(100000, 999999)}`,
              parent_phone: rand() > 0.4 ? `07${between(10, 99)}${between(100000, 999999)}` : null,
              email: null,
              enrollment_date: enrollment,
              monthly_fee: monthlyFee,
              status: (rand() > 0.93 ? "paused" : "active") as StudentStatus,
            });

            // Three months of billing history, newest last.
            for (let back = 2; back >= 0; back--) {
              const { period, year, month } = periodOf(back);
              const dueDate = new Date(year, month, Math.min(enrollment.getDate(), 28));

              let status: PaymentStatus;
              if (back > 0) {
                // Settled history, with the occasional straggler.
                status = rand() > 0.12 ? "paid" : "overdue";
              } else {
                const roll = rand();
                status = roll > 0.62 ? "paid" : roll > 0.42 ? "not_paid" : roll > 0.22 ? "due_soon" : "overdue";
              }

              const isPaid = status === "paid";
              const paidAt = isPaid ? new Date(dueDate.getTime() - between(0, 6) * 86_400_000) : null;

              paymentRows.push({
                id: randomUUID(),
                student_id: studentId,
                period,
                amount_due: monthlyFee,
                due_date: dueDate,
                status,
                paid_amount: isPaid ? monthlyFee : null,
                paid_at: paidAt,
                recorded_by: isPaid ? admin.id : null,
                payment_method: isPaid ? "cash" : null,
              });
            }
          }
        }
      }
    }
  }

  // Bulk inserts, parent tables first.
  await prisma.fields.createMany({ data: fieldRows });
  await prisma.professors.createMany({ data: profRows });
  await prisma.levels.createMany({ data: levelRows });
  await prisma.groups.createMany({ data: groupRows });
  await prisma.students.createMany({ data: studentRows });
  await prisma.student_payments.createMany({ data: paymentRows, skipDuplicates: true });

  const paid = paymentRows.filter((p) => p.status === "paid").length;
  console.log("Demo data seeded:");
  console.log(`  ${fieldRows.length} fields, ${profRows.length} professors, ${levelRows.length} levels, ${groupRows.length} groups`);
  console.log(`  ${studentRows.length} students, ${paymentRows.length} payments (${paid} paid)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
