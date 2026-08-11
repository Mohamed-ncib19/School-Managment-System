import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { seedClient } from "../db/seed-util";
import {
  studentStatus,
  fields,
  levels,
  professors,
  groups,
  students,
  studentAssignments,
  studentPayments,
  users,
} from "../db/schema";

type StudentStatus = (typeof studentStatus.enumValues)[number];

const { db, close } = seedClient();

/**
 * Inject a fixed-size demo dataset and wipe the existing hierarchy first.
 *
 *   pnpm run db:seed:custom
 *
 * Structure:
 *   2 levels
 *     -> 2 fields each
 *        -> 2 professors each
 *           -> 4 groups each
 *              -> 10 students each
 *                 -> 4 months of payment records each
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
const GROUP_SUFFIXES = ["A", "B", "C", "D"] as const;

const FIRST_NAMES = [
  "Yasmine", "Mehdi", "Lina", "Anis", "Sarah", "Bilal", "Imane", "Walid",
  "Nour", "Adel", "Rania", "Sami", "Hiba", "Zaki", "Meriem", "Riad",
  "Dalia", "Omar", "Nadia", "Tarek",
] as const;
const LAST_NAMES = [
  "Bouzid", "Khelifi", "Saidi", "Mansouri", "Ferhat", "Larbi", "Aissaoui",
  "Zerrouki", "Belhadj", "Toumi", "Ouali", "Djebbar",
] as const;

const PAYMENT_STATUSES: readonly string[] = [
  "paid",
  "paid",
  "paid",
  "paid",
  "not_paid",
  "due_soon",
  "overdue",
];

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

let seed = 20260731;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

async function reset() {
  // FK order: payments -> students -> groups -> professors -> fields -> levels.
  await db.delete(studentPayments);
  await db.delete(students);
  await db.delete(groups);
  await db.delete(professors);
  await db.delete(fields);
  await db.delete(levels);
  console.log("reset: hierarchy tables cleared");
}

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@school.local";
  const admin = await db.query.users.findFirst({ where: eq(users.email, adminEmail) });
  if (!admin) {
    throw new Error(`Admin ${adminEmail} not found — run "pnpm run db:seed" first.`);
  }

  await reset();

  const fieldRows: any[] = [];
  const profRows: any[] = [];
  const levelRows: any[] = [];
  const groupRows: any[] = [];
  const studentRows: any[] = [];
  const assignmentRows: any[] = [];
  const paymentRows: any[] = [];

  for (const levelName of LEVEL_NAMES) {
    const levelId = randomUUID();
    levelRows.push({
      id: levelId,
      name: levelName,
      is_active: true,
    });

    for (const field of FIELDS) {
      const fieldId = randomUUID();
      fieldRows.push({
        id: fieldId,
        level_id: levelId,
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
          phone: `+216${between(20, 99)}${between(100000, 999999)}`,
          email: `${profName.toLowerCase().replace(/\s+/g, ".")}@school.local`,
          is_active: true,
        });

        for (const suffix of GROUP_SUFFIXES) {
          const groupId = randomUUID();
          groupRows.push({
            id: groupId,
            prof_id: profId,
            name: `${levelName} ${suffix}`,
            capacity: between(12, 20),
            schedule_notes: pick([
              "Mon/Wed 17:00",
              "Tue/Thu 18:30",
              "Sat 09:00",
              "Sun 14:00",
            ]),
            is_active: true,
          });

          for (let i = 0; i < 10; i++) {
            const studentId = randomUUID();
            const enrolledMonthsAgo = between(3, 6);
            const enrollment = new Date();
            enrollment.setMonth(enrollment.getMonth() - enrolledMonthsAgo);
            enrollment.setDate(between(1, 28));
            const monthlyFee = 50;

            studentRows.push({
              id: studentId,
              group_id: groupId,
              first_name: pick(FIRST_NAMES),
              last_name: pick(LAST_NAMES),
              phone: `+216${between(20, 99)}${between(100000, 999999)}`,
              parent_phone: `+216${between(20, 99)}${between(100000, 999999)}`,
              email: null,
              enrollment_date: enrollment,
              monthly_fee: monthlyFee,
              status: "active" as StudentStatus,
            });
            assignmentRows.push({ student_id: studentId, group_id: groupId, fee: monthlyFee });

            for (let back = 3; back >= 0; back--) {
              const { period, year, month } = periodOf(back);
              const dueDate = new Date(year, month, Math.min(enrollment.getDate(), 28));
              const status = pick(PAYMENT_STATUSES);
              const isPaid = status === "paid";
              const paidAt = isPaid
                ? new Date(dueDate.getTime() - between(0, 6) * 86_400_000)
                : null;

              paymentRows.push({
                id: randomUUID(),
                student_id: studentId,
                group_id: groupId,
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

  await db.insert(levels).values(levelRows);
  await db.insert(fields).values(fieldRows);
  await db.insert(professors).values(profRows);
  await db.insert(groups).values(groupRows);
  await db.insert(students).values(studentRows);
  await db.insert(studentAssignments).values(assignmentRows);
  await db.insert(studentPayments).values(paymentRows).onConflictDoNothing();

  const paid = paymentRows.filter((p) => p.status === "paid").length;
  console.log("Custom seed complete:");
  console.log(
    `  ${levelRows.length} levels, ${fieldRows.length} fields, ${profRows.length} professors, ${groupRows.length} groups`
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
    await close();
  });