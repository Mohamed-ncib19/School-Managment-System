import { Prisma } from "@prisma/client";
import { DateRange, parseBoundary, quickRange, defaultRangeFor, type Granularity } from "./period.util";

/**
 * Translates the one filter shape the API accepts into the several `where`
 * clauses the schema needs.
 *
 * The hierarchy is level > field > professor > group > student, so every
 * academic filter is the same walk up that chain from whichever end the caller
 * pinned. Keeping the translation here means the dashboard, the analytics
 * charts, the reports and the exports cannot drift into scoping the same
 * request differently.
 */

export interface AcademicFilter {
  levelId?: string;
  fieldId?: string;
  profId?: string;
  groupId?: string;
  studentId?: string;
}

/**
 * Narrowest wins. Filters are not intersected: pinning a group already implies
 * its professor, field and level, and ANDing them would only add joins that can
 * never exclude a row.
 *
 * Students are scoped by their enrollments: a student registered in two groups
 * matches a filter on either one, because both enrollments bill and collect.
 */
export function studentWhere(filter: AcademicFilter): Prisma.studentsWhereInput | undefined {
  if (filter.studentId) return { id: filter.studentId };
  if (filter.groupId) return { assignments: { some: { group_id: filter.groupId } } };
  if (filter.profId) return { assignments: { some: { group: { prof_id: filter.profId } } } };
  if (filter.fieldId) {
    return { assignments: { some: { group: { professor: { field_id: filter.fieldId } } } } };
  }
  if (filter.levelId) {
    return { assignments: { some: { group: { professor: { field: { level_id: filter.levelId } } } } } };
  }
  return undefined;
}

/**
 * The same filter expressed against `student_payments`.
 *
 * Every invoice names the enrollment it bills, so the group chain is answered
 * straight off the invoice rather than through the student — which is exactly
 * what makes per-group scoping include a multi-group student's secondary
 * invoices.
 */
export function paymentWhere(filter: AcademicFilter): Prisma.student_paymentsWhereInput {
  if (filter.studentId) return { student_id: filter.studentId };
  if (filter.groupId) return { group_id: filter.groupId };
  if (filter.profId) return { group: { prof_id: filter.profId } };
  if (filter.fieldId) return { group: { professor: { field_id: filter.fieldId } } };
  if (filter.levelId) return { group: { professor: { field: { level_id: filter.levelId } } } };
  return {};
}

/** The same filter expressed against the ledger. */
export function transactionWhere(filter: AcademicFilter): Prisma.payment_transactionsWhereInput {
  // The ledger denormalises `prof_id`, so anything pinned at or above the
  // professor can be answered without joining through the invoice at all.
  if (filter.profId && !filter.groupId && !filter.studentId) return { prof_id: filter.profId };

  const payment = paymentWhere(filter);
  return Object.keys(payment).length > 0 ? { payment } : {};
}

/** The same filter expressed against `professors`. */
export function professorWhere(filter: AcademicFilter): Prisma.professorsWhereInput {
  if (filter.profId) return { id: filter.profId };
  if (filter.groupId) return { groups: { some: { id: filter.groupId } } };
  if (filter.fieldId) return { field_id: filter.fieldId };
  if (filter.levelId) return { field: { level_id: filter.levelId } };
  return {};
}

/**
 * Resolves the three ways a caller can express a window — a named quick range,
 * an explicit from/to, or nothing at all — into one concrete range.
 *
 * A named range wins over explicit dates, because the UI sends the quick-filter
 * chip and the date inputs together and the chip is the more recent intent.
 */
export function resolveRange(
  query: { range?: string; from?: string; to?: string; period?: string },
  granularity: Granularity,
  academicYearStartMonth: number,
  now: Date = new Date(),
): DateRange {
  if (query.range) {
    const named = quickRange(query.range, now, academicYearStartMonth);
    if (named) return named;
  }

  if (query.period) {
    const [year, month] = query.period.split("-").map(Number);
    return {
      from: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
      to: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
    };
  }

  const from = query.from ? parseBoundary(query.from, "from") : null;
  const to = query.to ? parseBoundary(query.to, "to") : null;

  if (from && to) {
    // A reversed range is a UI slip, not an error worth failing the request for.
    return from <= to ? { from, to } : { from: to, to: from };
  }

  const fallback = defaultRangeFor(granularity, now);
  return { from: from ?? fallback.from, to: to ?? fallback.to };
}

/** True when the caller pinned nothing academic — lets callers skip a join. */
export function isUnfiltered(filter: AcademicFilter): boolean {
  return !filter.levelId && !filter.fieldId && !filter.profId && !filter.groupId && !filter.studentId;
}
