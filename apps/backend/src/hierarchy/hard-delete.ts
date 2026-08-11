import { eq, inArray } from "drizzle-orm";
import { DbService } from "../db/db.service";
import {
  fields,
  groups,
  levels,
  paymentTransactions,
  professors,
  studentPayments,
  students,
} from "../db/schema";

export type HierarchyDeleteType = "level" | "field" | "professor" | "group";

export interface PurgeCounts {
  fields: number;
  professors: number;
  groups: number;
  students: number;
  payments: number;
}

/**
 * Permanently removes an archived hierarchy node and everything beneath it:
 * level > field > professor > group > student > payments.
 *
 * Only a row delete can do this — the archive flow keeps rows so references
 * survive. Here the whole subtree is collected first, then removed bottom-up
 * inside one transaction so nothing is left half-deleted. Payment records are
 * financial history, so this is an explicit destructive act, not an accident.
 */
export async function hardDeleteHierarchy(
  db: DbService,
  type: HierarchyDeleteType,
  id: string,
): Promise<PurgeCounts> {
  const counts: PurgeCounts = { fields: 0, professors: 0, groups: 0, students: 0, payments: 0 };

  await db.client.transaction(async (tx) => {
    const fieldIds =
      type === "level"
        ? (await tx.select({ id: fields.id }).from(fields).where(eq(fields.level_id, id))).map((f) => f.id)
        : type === "field"
          ? [id]
          : [];

    const professorIds =
      fieldIds.length > 0
        ? (await tx.select({ id: professors.id }).from(professors).where(inArray(professors.field_id, fieldIds))).map(
            (p) => p.id,
          )
        : type === "professor"
          ? [id]
          : [];

    const groupIds =
      professorIds.length > 0
        ? (await tx.select({ id: groups.id }).from(groups).where(inArray(groups.prof_id, professorIds))).map((g) => g.id)
        : type === "group"
          ? [id]
          : [];

    const studentIds =
      groupIds.length > 0
        ? (await tx.select({ id: students.id }).from(students).where(inArray(students.group_id, groupIds))).map(
            (s) => s.id,
          )
        : [];

    // Payments go first: transactions cascade off student_payments at the DB
    // level, and the students FK does not cascade, so the money rows must fall
    // before the students that own them.
    if (studentIds.length > 0) {
      const paymentIds = (
        await tx.select({ id: studentPayments.id }).from(studentPayments).where(inArray(studentPayments.student_id, studentIds))
      ).map((p) => p.id);
      if (paymentIds.length > 0) {
        const result = await tx.delete(paymentTransactions).where(inArray(paymentTransactions.payment_id, paymentIds));
        counts.payments += result.rowCount ?? 0;
      }
      const removedPayments = await tx.delete(studentPayments).where(inArray(studentPayments.student_id, studentIds));
      counts.payments += removedPayments.rowCount ?? 0;
      const removed = await tx.delete(students).where(inArray(students.id, studentIds));
      counts.students += removed.rowCount ?? 0;
    }

    // Invoices are per enrollment (RESTRICT FK from student_payments to
    // groups), so a surviving student's invoices for a purged group must fall
    // with the group, or the delete is refused.
    if (groupIds.length > 0) {
      const purged = await tx.delete(studentPayments).where(inArray(studentPayments.group_id, groupIds));
      counts.payments += purged.rowCount ?? 0;
    }

    // The target itself is excluded from the batch deletes below — it falls
    // via the final `delete` in the switch.
    if (groupIds.length > 0) {
      const result = await tx.delete(groups).where(inArray(groups.id, groupIds.filter((g) => g !== id)));
      counts.groups += result.rowCount ?? 0;
    }

    // Professor-linked transactions (e.g. payroll entries referencing the
    // professor) have a plain FK without a cascade — clear them explicitly.
    if (professorIds.length > 0) {
      const txnResult = await tx.delete(paymentTransactions).where(inArray(paymentTransactions.prof_id, professorIds));
      counts.payments += txnResult.rowCount ?? 0;
      const removed = await tx.delete(professors).where(inArray(professors.id, professorIds.filter((p) => p !== id)));
      counts.professors += removed.rowCount ?? 0;
    }

    if (fieldIds.length > 0) {
      const result = await tx.delete(fields).where(inArray(fields.id, fieldIds.filter((f) => f !== id)));
      counts.fields += result.rowCount ?? 0;
    }

    switch (type) {
      case "level":
        await tx.delete(levels).where(eq(levels.id, id));
        break;
      case "field":
        await tx.delete(fields).where(eq(fields.id, id));
        break;
      case "professor":
        await tx.delete(professors).where(eq(professors.id, id));
        break;
      case "group":
        await tx.delete(groups).where(eq(groups.id, id));
        break;
    }
  });

  return counts;
}