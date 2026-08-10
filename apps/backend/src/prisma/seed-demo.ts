import { PrismaClient, CompensationModel, StudentStatus } from "@prisma/client";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

/**
 * Fills the database with a realistic demo hierarchy so the UI can be judged
 * and query performance measured against something other than empty tables.
 *
 *   pnpm run db:seed:demo            add the demo data (idempotent-ish)
 *   pnpm run db:seed:demo -- --reset wipe ALL hierarchy data first
 *
 * `--reset` deletes every level/field/professor/group/student/payment, not just
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
  // FK order: payments -> students -> groups -> professors -> fields -> levels.
  await prisma.student_payments.deleteMany({});
  await prisma.students.deleteMany({});
  await prisma.groups.deleteMany({});
  await prisma.professors.deleteMany({});
  await prisma.fields.deleteMany({});
  await prisma.levels.deleteMany({});
  console.log("  reset: hierarchy tables cleared");
}

async function main() {
  const shouldReset = process.argv.includes("--reset");

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@school.local";
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
  const assignmentRows: { student_id: string; group_id: string; fee: number }[] = [];
  const paymentRows: any[] = [];

  /** Every group with the field it hangs from, for cross-field enrollments. */
  const groupFields: Array<{ groupId: string; fieldId: string }> = [];
  /** Every student with their primary group's field and enrollment date. */
  const studentRefs: Array<{ studentId: string; fieldId: string; enrollment: Date }> = [];

  for (const levelName of LEVEL_NAMES) {
    const levelId = randomUUID();
    levelRows.push({ id: levelId, name: levelName });

    // 1-2 fields per level.
    for (const field of FIELDS.slice(0, between(1, 2))) {
      const fieldId = randomUUID();
      fieldRows.push({
        id: fieldId,
        level_id: levelId,
        name: field.name,
        description: field.description,
        created_by: admin.id,
      });

      for (const profName of PROFESSORS[field.name]) {
        const profId = randomUUID();
        profRows.push({
          id: profId,
          field_id: fieldId,
          full_name: profName,
          phone: `+216${between(20, 99)}${between(100000, 999999)}`,
          email: `${profName.toLowerCase().replace(/\s+/g, ".")}@school.local`,
          is_active: true,
        });

        // 1-2 groups per professor.
        for (const suffix of GROUP_SUFFIX.slice(0, between(1, 2))) {
          const groupId = randomUUID();
          groupRows.push({
            id: groupId,
            prof_id: profId,
            name: `${levelName} ${suffix}`,
            capacity: between(12, 20),
            schedule_notes: pick(["Mon/Wed 17:00", "Tue/Thu 18:30", "Sat 09:00", "Sun 14:00"]),
          });
          groupFields.push({ groupId, fieldId });

          // 5-9 students per group.
          const count = between(5, 9);
          for (let i = 0; i < count; i++) {
            const studentId = randomUUID();
            const enrolledMonthsAgo = between(1, 10);
            const enrollment = new Date();
            enrollment.setMonth(enrollment.getMonth() - enrolledMonthsAgo);
            enrollment.setDate(between(1, 28));
            const monthlyFee = 50;

            studentRefs.push({ studentId, fieldId, enrollment });

            studentRows.push({
              id: studentId,
              group_id: groupId,
              first_name: pick(FIRST_NAMES),
              last_name: pick(LAST_NAMES),
              phone: `+216${between(20, 99)}${between(100000, 999999)}`,
              parent_phone: rand() > 0.4 ? `+216${between(20, 99)}${between(100000, 999999)}` : null,
              email: null,
              enrollment_date: enrollment,
              monthly_fee: monthlyFee,
              status: (rand() > 0.93 ? "paused" : "active") as StudentStatus,
            });
            assignmentRows.push({ student_id: studentId, group_id: groupId, fee: monthlyFee });

            // One invoice for the current month.
            {
              const { period, year, month } = periodOf(0);
              const dueDate = new Date(year, month, Math.min(enrollment.getDate(), 28));

              const roll = rand();
              const status = roll > 0.62 ? "paid" : roll > 0.42 ? "not_paid" : roll > 0.22 ? "due_soon" : "overdue";

              const isPaid = status === "paid";
              const paidAt = isPaid ? new Date(dueDate.getTime() - between(0, 6) * 86_400_000) : null;

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

  // ── Cross-field enrollments ────────────────────────────────────────────
  // A share of students also joins a group in a different field (hence a
  // different professor), with its own invoice per period. The primary group
  // stays `students.group_id` for dashboard roll-ups.
  const crossEnrolled = studentRefs.filter(() => rand() > 0.85);
  for (const s of crossEnrolled) {
    const candidates = groupFields.filter((g) => g.fieldId !== s.fieldId);
    if (candidates.length === 0) continue;
    const secondGroup = pick(candidates);
    const secondFee = 50;

    assignmentRows.push({ student_id: s.studentId, group_id: secondGroup.groupId, fee: secondFee });

    {
      const { period, year, month } = periodOf(0);
      const dueDate = new Date(year, month, Math.min(s.enrollment.getDate(), 28));
      const isPaid = rand() > 0.55;
      const isLate = !isPaid && rand() > 0.4;
      paymentRows.push({
        id: randomUUID(),
        student_id: s.studentId,
        group_id: secondGroup.groupId,
        period,
        amount_due: secondFee,
        due_date: dueDate,
        status: isPaid ? "paid" : isLate ? "overdue" : "not_paid",
        paid_amount: isPaid ? secondFee : null,
        paid_at: isPaid ? new Date(dueDate.getTime() - between(0, 6) * 86_400_000) : null,
        recorded_by: isPaid ? admin.id : null,
        payment_method: isPaid ? "cash" : null,
      });
    }
  }

  // ── Payment transactions ───────────────────────────────────────────────
  // Every paid invoice gets its ledger row, exactly like a real collection, so
  // professor payouts and revenue roll-ups reflect the money coming in. The
  // split mirrors the academy default rule: 60% professor / 40% academy.
  const PROFESSOR_PERCENT = 60;
  const groupProfMap: Record<string, string> = {};
  for (const g of groupRows) groupProfMap[g.id] = g.prof_id;

  let receiptCounter = 0;
  const transactionRows = paymentRows
    .filter((p) => p.status === "paid")
    .map((p) => {
      receiptCounter++;
      const amount = Number(p.paid_amount);
      const profShare = Math.round((amount * PROFESSOR_PERCENT) / 100 * 100) / 100;
      return {
        id: randomUUID(),
        payment_id: p.id,
        type: "payment" as const,
        amount: p.paid_amount,
        method: "cash" as const,
        receipt_number: `RCP-${new Date(p.paid_at).getFullYear()}-${String(receiptCounter).padStart(6, "0")}`,
        paid_at: p.paid_at,
        recorded_by: admin.id,
        notes: null,
        reason: null,
        professor_share: profShare,
        school_share: Math.round((amount - profShare) * 100) / 100,
        compensation_model: "percentage" as CompensationModel,
        compensation_snapshot: JSON.stringify({ model: "percentage", percentage: PROFESSOR_PERCENT }),
        prof_id: groupProfMap[p.group_id] ?? null,
        period: p.period,
      };
    });

  // Bulk inserts, parent tables first.
  await prisma.levels.createMany({ data: levelRows });
  await prisma.fields.createMany({ data: fieldRows });
  await prisma.professors.createMany({ data: profRows });
  await prisma.groups.createMany({ data: groupRows });
  await prisma.students.createMany({ data: studentRows });
  await prisma.student_assignments.createMany({ data: assignmentRows });
  await prisma.student_payments.createMany({ data: paymentRows, skipDuplicates: true });
  await prisma.payment_transactions.createMany({ data: transactionRows, skipDuplicates: true });

  const paid = paymentRows.filter((p) => p.status === "paid").length;
  console.log("Demo data seeded:");
  console.log(`  ${levelRows.length} levels, ${fieldRows.length} fields, ${profRows.length} professors, ${groupRows.length} groups`);
  console.log(`  ${studentRows.length} students, ${paymentRows.length} payments (${paid} paid), ${transactionRows.length} ledger transactions`);
  const crossCount = assignmentRows.length - studentRows.length;
  if (crossCount > 0) {
    console.log(`  ${crossCount} students also enrolled in a second field (${assignmentRows.length} enrollments total)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
