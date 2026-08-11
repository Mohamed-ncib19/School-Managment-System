import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { seedClient } from "../db/seed-util";
import {
  paymentStatus,
  fields,
  levels,
  professors,
  groups,
  students,
  studentAssignments,
  studentPayments,
  paymentTransactions,
  payrollDocuments,
  payrollPayments,
  professorCompensations,
  receiptCounters,
  users,
} from "../db/schema";

type PaymentStatus = (typeof paymentStatus.enumValues)[number];

const { db, close } = seedClient();

// ── Deterministic PRNG ──────────────────────────────────────────────────────
let seed = 20260803;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

// ── Data pools ──────────────────────────────────────────────────────────────
const LEVEL_NAMES = ["1ere Annee", "2eme Annee", "3eme Annee", "4eme Annee"] as const;

const FIELD_NAMES = [
  "Mathematiques", "Physique", "Informatique", "Chimie",
  "Francais", "Anglais", "Arabe", "Histoire-Geographie",
  "SVT", "Philosophie", "Economie", "Droit",
  "Technique", "Art", "Sport", "Musique",
] as const;

const FIRST_NAMES = [
  "Yasmine", "Mehdi", "Lina", "Anis", "Sarah", "Bilal", "Imane", "Walid",
  "Nour", "Adel", "Rania", "Sami", "Hiba", "Zaki", "Meriem", "Riad",
  "Fatima", "Amine", "Nadia", "Omar", "Leila", "Karim", "Houda", "Sofiane",
  "Aicha", "Reda", "Salima", "Youcef", "Lamia", "Nabil", "Asma", "Rachid",
] as const;

const LAST_NAMES = [
  "Bouzid", "Khelifi", "Saidi", "Mansouri", "Ferhat", "Larbi", "Aissaoui",
  "Zerrouki", "Belhadj", "Toumi", "Ouali", "Djebbar", "Charef", "Mebarki",
  "Hammadi", "Bouazza", "Guerfi", "Benmalek", "Aoufi", "Rahal", "Taleb",
  "Bouhadja", "Mokrani", "Cherif", "Bensalem", "Hamidou", "Kaci", "Meziane",
] as const;

const SCHEDULES = [
  "Lun/Mer 08:00-10:00", "Mar/Jeu 10:00-12:00", "Mer/Ven 14:00-16:00",
  "Lun/Mer 16:00-18:00", "Mar/Jeu 08:00-10:00", "Ven/Sam 10:00-12:00",
  "Sam 08:00-12:00", "Dim 14:00-18:00", "Lun/Mer/Ven 07:00-09:00",
] as const;

const LEVEL_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"] as const;
const FIELD_COLORS = ["#6366f1", "#8b5cf6", "#a855f7", "#d946ef"] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Return { period: "YYYY-MM", year, month } for `monthsAgo` months back from now. */
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

// ── Reset ───────────────────────────────────────────────────────────────────
async function reset() {
  console.log("  Erasing all data...");
  // FK-safe order
  await db.delete(paymentTransactions);
  await db.delete(payrollDocuments);
  await db.delete(payrollPayments);
  await db.delete(professorCompensations);
  await db.delete(studentPayments);
  await db.delete(studentAssignments);
  await db.delete(students);
  await db.delete(groups);
  await db.delete(professors);
  await db.delete(fields);
  await db.delete(levels);
  await db.delete(receiptCounters);
  // Keep users and audit_logs
  console.log("  Done.");
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Full seed: erasing hierarchy + injecting 4 levels × 4 fields × 4 profs × 3 groups × 10 students...");
  await reset();

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@school.local";
  const admin = await db.query.users.findFirst({ where: eq(users.email, adminEmail) });
  if (!admin) throw new Error(`Admin ${adminEmail} not found — run "npm run seed" first.`);

  const levelRows: any[] = [];
  const fieldRows: any[] = [];
  const profRows: any[] = [];
  const groupRows: any[] = [];
  const studentRows: any[] = [];
  const assignmentRows: any[] = [];
  const paymentRows: any[] = [];
  const transactionRows: any[] = [];

  let levelIdx = 0;
  for (const levelName of LEVEL_NAMES) {
    const levelId = randomUUID();
    levelRows.push({ id: levelId, name: levelName, color: LEVEL_COLORS[levelIdx] });

    // 4 fields per level (cycle through field names)
    for (let f = 0; f < 4; f++) {
      const fieldName = FIELD_NAMES[(levelIdx * 4 + f) % FIELD_NAMES.length];
      const fieldId = randomUUID();
      fieldRows.push({
        id: fieldId,
        level_id: levelId,
        name: fieldName,
        description: `${fieldName} — ${levelName}`,
        color: FIELD_COLORS[f % FIELD_COLORS.length],
        created_by: admin.id,
      });

      // 4 professors per field
      for (let p = 0; p < 4; p++) {
        const firstName = pick(FIRST_NAMES);
        const lastName = pick(LAST_NAMES);
        const profId = randomUUID();
        profRows.push({
          id: profId,
          field_id: fieldId,
          full_name: `${firstName} ${lastName}`,
          phone: `+216${between(20, 99)}${between(100000, 999999)}`,
          email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@school.local`,
          is_active: true,
        });

        // 3 groups per professor
        for (let g = 0; g < 3; g++) {
          const groupId = randomUUID();
          const suffix = ["A", "B", "C"][g];
          groupRows.push({
            id: groupId,
            prof_id: profId,
            name: `${levelName} ${fieldName} ${suffix}`,
            capacity: between(15, 25),
            schedule_notes: pick(SCHEDULES),
          });

          // 10 students per group
          for (let s = 0; s < 10; s++) {
            const studentId = randomUUID();
            // Enroll 12-48 months ago (1-4 years)
            const enrolledMonthsAgo = between(12, 48);
            const enrollment = new Date();
            enrollment.setMonth(enrollment.getMonth() - enrolledMonthsAgo);
            enrollment.setDate(between(1, 28));
            const monthlyFee = 50; // 50 TND per month

            studentRows.push({
              id: studentId,
              group_id: groupId,
              first_name: pick(FIRST_NAMES),
              last_name: pick(LAST_NAMES),
              phone: `+216${between(20, 99)}${between(100000, 999999)}`,
              parent_phone: rand() > 0.3 ? `+216${between(20, 99)}${between(100000, 999999)}` : null,
              email: null,
              enrollment_date: enrollment,
              monthly_fee: monthlyFee,
              status: (rand() > 0.95 ? "paused" : "active") as "active" | "paused",
            });
            assignmentRows.push({ student_id: studentId, group_id: groupId, fee: monthlyFee });

            // Generate monthly payments from enrollment to now
            const now = new Date();
            const enrollDate = new Date(enrollment);
            const monthsSpan = (now.getFullYear() - enrollDate.getFullYear()) * 12 + (now.getMonth() - enrollDate.getMonth());

            for (let m = 0; m <= monthsSpan; m++) {
              const { period, year, month } = periodOf(monthsSpan - m);
              const dueDate = new Date(year, month, Math.min(enrollment.getDate(), 28));

              let status: PaymentStatus;
              const isLastMonth = m === monthsSpan;
              const dueDateMs = dueDate.getTime();
              const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
              const twoDaysMs = 2 * 86_400_000;

              if (isLastMonth) {
                const roll = rand();
                if (roll > 0.55) {
                  status = "paid";
                } else if (roll > 0.35) {
                  // Not paid: check if overdue or due soon
                  if (todayMs > dueDateMs) {
                    status = "overdue";
                  } else if (dueDateMs - todayMs <= twoDaysMs) {
                    status = "due_soon";
                  } else {
                    status = "not_paid";
                  }
                } else {
                  status = "partially_paid";
                }
              } else {
                // Historical: mostly paid
                status = rand() > 0.08 ? "paid" : rand() > 0.5 ? "overdue" : "partially_paid";
              }

              const isPaid = status === "paid";
              const isPartial = status === "partially_paid";
              const paidAmount = isPaid ? monthlyFee : isPartial ? Math.round(monthlyFee * (0.3 + rand() * 0.5) * 100) / 100 : null;
              const paidAt = (isPaid || isPartial) ? new Date(dueDate.getTime() + between(-5, 15) * 86_400_000) : null;

              paymentRows.push({
                id: randomUUID(),
                student_id: studentId,
                group_id: groupId,
                period,
                amount_due: monthlyFee,
                due_date: dueDate,
                status,
                paid_amount: paidAmount,
                paid_at: paidAt,
                recorded_by: (isPaid || isPartial) ? admin.id : null,
                payment_method: (isPaid || isPartial) ? "cash" : null,
                notes: null,
              });
            }
          }
        }
      }
    }
    levelIdx++;
  }

  // ── Bulk insert ─────────────────────────────────────────────────────────
  console.log("  Inserting levels...");
  await db.insert(levels).values(levelRows);

  console.log("  Inserting fields...");
  await db.insert(fields).values(fieldRows);

  console.log("  Inserting professors...");
  await db.insert(professors).values(profRows);

  console.log("  Inserting groups...");
  await db.insert(groups).values(groupRows);

  console.log("  Inserting students...");
  await db.insert(students).values(studentRows);

  console.log("  Inserting assignments...");
  await db.insert(studentAssignments).values(assignmentRows);

  // ── Cross-field students: 10% of students get a second group in the same level ──
  console.log("  Creating cross-field students...");
  const crossPaymentRows: any[] = [];
  const crossAssignmentRows: any[] = [];

  // Group by level: level_id -> group[]
  const groupsByLevel: Record<string, typeof groupRows> = {};
  for (const g of groupRows) {
    const prof = profRows.find((p) => p.id === g.prof_id);
    const field = prof ? fieldRows.find((f) => f.id === prof.field_id) : null;
    const lvlId = field?.level_id;
    if (lvlId) {
      if (!groupsByLevel[lvlId]) groupsByLevel[lvlId] = [];
      groupsByLevel[lvlId].push(g);
    }
  }

  let crossCount = 0;
  for (const student of studentRows) {
    if (rand() > 0.10) continue; // 10% get a second enrollment
    if (crossCount >= 200) break; // cap

    const primaryGroupId = student.group_id;
    const primaryGroup = groupRows.find((g) => g.id === primaryGroupId);
    const primaryProf = primaryGroup ? profRows.find((p) => p.id === primaryGroup.prof_id) : null;
    const primaryField = primaryProf ? fieldRows.find((f) => f.id === primaryProf.field_id) : null;
    const lvlId = primaryField?.level_id;
    if (!lvlId) continue;

    // Find another group in the same level with a different field
    const levelGroups = (groupsByLevel[lvlId] ?? []).filter((g) => g.id !== primaryGroupId);
    const diffFieldGroups = levelGroups.filter((g) => {
      const p = profRows.find((pp) => pp.id === g.prof_id);
      const f = p ? fieldRows.find((ff) => ff.id === p.field_id) : null;
      return f && f.id !== primaryField?.id;
    });
    if (diffFieldGroups.length === 0) continue;

    const secondGroup = pick(diffFieldGroups);

    crossAssignmentRows.push({ student_id: student.id, group_id: secondGroup.id, fee: student.monthly_fee });
    crossCount++;

    // Generate payments for the second enrollment
    const now = new Date();
    const enrollDate = new Date(student.enrollment_date);
    const monthsSpan = (now.getFullYear() - enrollDate.getFullYear()) * 12 + (now.getMonth() - enrollDate.getMonth());
    for (let m = 0; m <= monthsSpan; m++) {
      const { period, year, month } = periodOf(monthsSpan - m);
      const dueDateD = new Date(year, month, Math.min(enrollDate.getDate(), 28));
      const isLast = m === monthsSpan;
      const nowMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const dueMs = dueDateD.getTime();

      let st: PaymentStatus;
      if (isLast) {
        const r = rand();
        if (r > 0.55) st = "paid";
        else if (r > 0.35) st = nowMs > dueMs ? "overdue" : (dueMs - nowMs <= 2 * 86_400_000 ? "due_soon" : "not_paid");
        else st = "partially_paid";
      } else {
        st = rand() > 0.08 ? "paid" : rand() > 0.5 ? "overdue" : "partially_paid";
      }

      const isPaid = st === "paid";
      const isPartial = st === "partially_paid";
      const paidAmt = isPaid ? student.monthly_fee : isPartial ? Math.round(student.monthly_fee * (0.3 + rand() * 0.5) * 100) / 100 : null;
      const paidAtD = (isPaid || isPartial) ? new Date(dueDateD.getTime() + between(-5, 15) * 86_400_000) : null;

      crossPaymentRows.push({
        id: randomUUID(),
        student_id: student.id,
        group_id: secondGroup.id,
        period,
        amount_due: student.monthly_fee,
        due_date: dueDateD,
        status: st,
        paid_amount: paidAmt,
        paid_at: paidAtD,
        recorded_by: (isPaid || isPartial) ? admin.id : null,
        payment_method: (isPaid || isPartial) ? "cash" : null,
        notes: null,
      });
    }
  }

  if (crossAssignmentRows.length > 0) {
    await db.insert(studentAssignments).values(crossAssignmentRows).onConflictDoNothing();
    await db.insert(studentPayments).values(crossPaymentRows).onConflictDoNothing();
    console.log(`  Created ${crossCount} cross-field student enrollments`);
  }

  console.log("  Inserting payments...");
  await db.insert(studentPayments).values(paymentRows).onConflictDoNothing();

  // ── Create payment_transactions for all paid/partial payments ──────────
  console.log("  Creating payment transactions...");
  const paidPayments = paymentRows.filter((p: any) => p.status === "paid" || p.status === "partially_paid");

  // Build a prof_id lookup: group_id -> professor id
  const groupProfMap: Record<string, string> = {};
  for (const g of groupRows) {
    groupProfMap[g.id] = g.prof_id;
  }

  let receiptCounter = 0;
  for (const p of paidPayments) {
    receiptCounter++;
    const profId = groupProfMap[p.group_id] ?? null;
    const amount = Number(p.paid_amount);
    const profShare = Math.round(amount * (0.4 + rand() * 0.2) * 100) / 100;
    const schoolShare = Math.round((amount - profShare) * 100) / 100;

    transactionRows.push({
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
      school_share: schoolShare,
      compensationModel: "percentage",
      compensation_snapshot: JSON.stringify({ model: "percentage", percentage: Math.round((profShare / amount) * 100) }) as unknown,
      prof_id: profId,
      period: p.period,
    });
  }

  if (transactionRows.length > 0) {
    // Insert in batches to avoid parameter limits
    const batchSize = 1000;
    for (let i = 0; i < transactionRows.length; i += batchSize) {
      const batch = transactionRows.slice(i, i + batchSize);
      await db.insert(paymentTransactions).values(batch).onConflictDoNothing();
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const paid = paymentRows.filter((p: any) => p.status === "paid").length;
  const partial = paymentRows.filter((p: any) => p.status === "partially_paid").length;
  const notPaid = paymentRows.filter((p: any) => p.status === "not_paid").length;
  const overdue = paymentRows.filter((p: any) => p.status === "overdue").length;
  const dueSoon = paymentRows.filter((p: any) => p.status === "due_soon").length;

  console.log("\n  ═══════════════════════════════════════════════════");
  console.log("  SEED COMPLETE");
  console.log("  ═══════════════════════════════════════════════════");
  console.log(`  Levels:     ${levelRows.length}`);
  console.log(`  Fields:     ${fieldRows.length}`);
  console.log(`  Professors: ${profRows.length}`);
  console.log(`  Groups:     ${groupRows.length}`);
  console.log(`  Students:   ${studentRows.length}`);
  console.log(`  Assignments:${assignmentRows.length}`);
  console.log(`  Payments:   ${paymentRows.length}`);
  console.log(`    - paid:      ${paid}`);
  console.log(`    - partial:   ${partial}`);
  console.log(`    - not_paid:  ${notPaid}`);
  console.log(`    - overdue:   ${overdue}`);
  console.log(`    - due_soon:  ${dueSoon}`);
  console.log(`  Transactions: ${transactionRows.length}`);
  console.log("  ═══════════════════════════════════════════════════");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await close();
  });