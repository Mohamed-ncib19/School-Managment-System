import { PrismaService } from "../prisma/prisma.service";

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
  prisma: PrismaService,
  type: HierarchyDeleteType,
  id: string,
): Promise<PurgeCounts> {
  const counts: PurgeCounts = { fields: 0, professors: 0, groups: 0, students: 0, payments: 0 };

  await prisma.$transaction(async (tx) => {
    const fieldIds =
      type === "level"
        ? (await tx.fields.findMany({ where: { level_id: id }, select: { id: true } })).map((f) => f.id)
        : type === "field"
          ? [id]
          : [];

    const professorIds =
      fieldIds.length > 0
        ? (await tx.professors.findMany({ where: { field_id: { in: fieldIds } }, select: { id: true } })).map((p) => p.id)
        : type === "professor"
          ? [id]
          : [];

    const groupIds =
      professorIds.length > 0
        ? (await tx.groups.findMany({ where: { prof_id: { in: professorIds } }, select: { id: true } })).map((g) => g.id)
        : type === "group"
          ? [id]
          : [];

    const studentIds =
      groupIds.length > 0
        ? (await tx.students.findMany({ where: { group_id: { in: groupIds } }, select: { id: true } })).map((s) => s.id)
        : [];

    // Payments go first: transactions cascade off student_payments at the DB
    // level, and the students FK does not cascade, so the money rows must fall
    // before the students that own them.
    if (studentIds.length > 0) {
      const { count: txns } = await tx.payment_transactions.deleteMany({
        where: { payment: { student_id: { in: studentIds } } },
      });
      counts.payments += txns;
      const { count: payments } = await tx.student_payments.deleteMany({
        where: { student_id: { in: studentIds } },
      });
      counts.payments += payments;
      const { count: removed } = await tx.students.deleteMany({ where: { id: { in: studentIds } } });
      counts.students += removed;
    }

    // Invoices are per enrollment (RESTRICT FK from student_payments to
    // groups), so a surviving student's invoices for a purged group must fall
    // with the group, or the delete is refused.
    if (groupIds.length > 0) {
      const { count: purged } = await tx.student_payments.deleteMany({
        where: { group_id: { in: groupIds } },
      });
      counts.payments += purged;
    }

    // The target itself is excluded from the batch deletes below — it falls
    // via the final `delete` in the switch, which would otherwise hit P2025.
    if (groupIds.length > 0) {
      const { count } = await tx.groups.deleteMany({ where: { id: { in: groupIds.filter((g) => g !== id) } } });
      counts.groups += count;
    }

    // Professor-linked transactions (e.g. payroll entries referencing the
    // professor) have a plain FK without a cascade — clear them explicitly.
    if (professorIds.length > 0) {
      const { count } = await tx.payment_transactions.deleteMany({
        where: { prof_id: { in: professorIds } },
      });
      counts.payments += count;
      const { count: removed } = await tx.professors.deleteMany({
        where: { id: { in: professorIds.filter((p) => p !== id) } },
      });
      counts.professors += removed;
    }

    if (fieldIds.length > 0) {
      const { count } = await tx.fields.deleteMany({ where: { id: { in: fieldIds.filter((f) => f !== id) } } });
      counts.fields += count;
    }

    switch (type) {
      case "level":
        await tx.levels.delete({ where: { id } });
        break;
      case "field":
        await tx.fields.delete({ where: { id } });
        break;
      case "professor":
        await tx.professors.delete({ where: { id } });
        break;
      case "group":
        await tx.groups.delete({ where: { id } });
        break;
    }
  });

  return counts;
}
