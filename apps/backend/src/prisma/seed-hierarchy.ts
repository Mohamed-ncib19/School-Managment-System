import { PrismaClient, PaymentStatus, StudentStatus } from "@prisma/client";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

/**
 * Exact hierarchy seed:
 *   2 fields
 *     -> 2 professors each
 *        -> 2 levels each
 *           -> 2 groups each
 *              -> 10 students each
 *                 -> 5 with 3 months of payment history
 *                 -> 5 new (no payments)
 *
 * Run: pnpm run db:seed:hierarchy
 */

const FIELDS = [
  { name: "Languages", description: "English, French and Arabic tracks" },
  { name: "Sciences", description: "Biology, chemistry and physics tracks" },
];

const PROFESSOR_NAMES: Record<string, string[]> = {
  Languages: ["Amina Belkacem", "Yacine Haddad"],
  Sciences: ["Karim Benali", "Sofia Meziane"],
};

const LEVEL_NAMES = ["Beginner", "Intermediate"] as const;
const GROUP_SUFFIXES = ["A", "B"] as const;

const FIRST_NAMES = [
  "Yasmine", "Mehdi", "Lina", "Anis", "Sarah", "Bilal", "Imane", "Walid",
  "Nour", "Adel", "Rania", "Sami", "Hiba", "Zaki", "Meriem", "Riad",
  "Dalia", "Omar", "Nadia", "Tarek",
] as const;
const LAST_NAMES = [
  "Bouzid", "Khelifi", "Saidi", "Mansouri", "Ferhat", "Larbi", "Aissaoui",
  "Zerrouki", "Belhadj", "Toumi", "Ouali", "Djebbar",
] as const;

function periodOf(monthsAgo: number) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  return {
    period: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    year: d.getFullYear(),
    month: d.getMonth(),
  };
}

let seed = 20260801;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

async function reset() {
  await prisma.student_payments.deleteMany({});
  await prisma.students.deleteMany({});
  await prisma.groups.deleteMany({});
  await prisma.levels.deleteMany({});
  await prisma.professors.deleteMany({});
  await prisma.fields.deleteMany({});
  console.log("reset: hierarchy tables cleared");
}

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@iqacademy.com";
  const admin = await prisma.users.findUnique({ where: { email: adminEmail } });
  if (!admin) {
    throw new Error(`Admin ${adminEmail} not found — run "pnpm run db:seed" first.`);
  }

  await reset();

  const fieldRows: any[] = [];
  const profRows: any[] = [];
  const levelRows: any[] = [];
  const groupRows: any[] = [];
  const studentRows: any[] = [];
  const paymentRows: any[] = [];

  for (const field of FIELDS) {
    const fieldId = randomUUID();
    fieldRows.push({
      id: fieldId,
      name: field.name,
      description: field.description,
      created_by: admin.id,
    });

    for (const profName of PROFESSOR_NAMES[field.name]) {
      const profId = randomUUID();
      profRows.push({
        id: profId,
        field_id: fieldId,
        full_name: profName,
        phone: `05${between(10, 99)}${between(100000, 999999)}`,
        email: `${profName.toLowerCase().replace(/\s+/g, ".")}@iqacademy.com`,
        is_active: true,
      });

      for (const levelName of LEVEL_NAMES) {
        const levelId = randomUUID();
        levelRows.push({
          id: levelId,
          prof_id: profId,
          name: levelName,
          is_active: true,
        });

        for (const suffix of GROUP_SUFFIXES) {
          const groupId = randomUUID();
          groupRows.push({
            id: groupId,
            level_id: levelId,
            name: `${levelName} ${suffix}`,
            capacity: 12,
            schedule_notes: pick(["Mon/Wed 17:00", "Tue/Thu 18:30", "Sat 09:00", "Sun 14:00"]),
            is_active: true,
          });

          for (let i = 0; i < 10; i++) {
            const studentId = randomUUID();
            const enrolledMonthsAgo = between(3, 5);
            const enrollment = new Date();
            enrollment.setMonth(enrollment.getMonth() - enrolledMonthsAgo);
            enrollment.setDate(between(1, 28));
            const monthlyFee = 40;

            studentRows.push({
              id: studentId,
              group_id: groupId,
              first_name: pick(FIRST_NAMES),
              last_name: pick(LAST_NAMES),
              phone: `06${between(10, 99)}${between(100000, 999999)}`,
              parent_phone: `07${between(10, 99)}${between(100000, 999999)}`,
              email: null,
              enrollment_date: enrollment,
              monthly_fee: monthlyFee,
              status: "active" as StudentStatus,
            });

            if (i < 5) {
              for (let back = 2; back >= 0; back--) {
                const { period, year, month } = periodOf(back);
                const dueDate = new Date(year, month, Math.min(enrollment.getDate(), 28));

                let status: PaymentStatus;
                if (back === 2) {
                  status = "paid";
                } else if (back === 1) {
                  status = pick(["paid", "paid", "due_soon", "overdue"]);
                } else {
                  status = pick(["paid", "not_paid", "due_soon", "overdue"]);
                }

                const isPaid = status === "paid";
                const paidAt = isPaid
                  ? new Date(dueDate.getTime() - between(0, 6) * 86_400_000)
                  : null;

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
  }

  await prisma.fields.createMany({ data: fieldRows });
  await prisma.professors.createMany({ data: profRows });
  await prisma.levels.createMany({ data: levelRows });
  await prisma.groups.createMany({ data: groupRows });
  await prisma.students.createMany({ data: studentRows });
  await prisma.student_payments.createMany({ data: paymentRows, skipDuplicates: true });

  const paid = paymentRows.filter((p) => p.status === "paid").length;
  console.log("Hierarchy seed complete:");
  console.log(
    `  ${fieldRows.length} fields, ${profRows.length} professors, ${levelRows.length} levels, ${groupRows.length} groups`
  );
  console.log(
    `  ${studentRows.length} students, ${paymentRows.length} payments (${paid} paid)`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
