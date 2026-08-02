/**
 * Billing-date arithmetic, shared by every generator so a due date means the
 * same thing however the row was created.
 *
 * Everything here works in UTC. `enrollment_date` is stored as a UTC midnight
 * (see StudentsService.parseDate), and building the due date with the local
 * `new Date(y, m, d)` constructor instead would shift it a day backwards for
 * any server east of Greenwich — a 31st due date persisted as `…-30T23:00:00Z`.
 */

/**
 * A monthly invoice is due on the day of the month the student enrolled — the
 * enrolment anniversary — so a student inscribed on the 15th pays on the 15th
 * of every month: the first invoice (the month of enrolment) falls due on the
 * inscription date itself, the "due soon" window opens two days before it, and
 * the invoice is plain "not paid" once it passes.
 *
 * Short months are clamped: an enrolment on the 31st settles on the 28th of
 * February. `month` is 0-indexed.
 */
export function dueDateFor(year: number, month: number, enrollmentDate: Date): Date {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(enrollmentDate.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, month, day));
}

/** The `YYYY-MM` period label for a UTC year/month pair. `month` is 0-indexed. */
export function periodOf(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/**
 * Every period a student owes, from the month they enrolled through `upTo`
 * inclusive. Backfilling from enrollment is what stops the enrolment month from
 * going unbilled, and it lets a student imported with a back-dated enrolment
 * date pick up the months they missed.
 *
 * Capped at MAX_BACKFILL_MONTHS so one mistyped year in an import workbook
 * can't generate a decade of invoices.
 */
export const MAX_BACKFILL_MONTHS = 24;

export function billingPeriods(
  enrollmentDate: Date,
  upTo: Date,
): { year: number; month: number; period: string }[] {
  const lastYear = upTo.getUTCFullYear();
  const lastMonth = upTo.getUTCMonth();

  const earliest = lastYear * 12 + lastMonth - MAX_BACKFILL_MONTHS;
  const enrolled = enrollmentDate.getUTCFullYear() * 12 + enrollmentDate.getUTCMonth();
  let cursor = Math.max(enrolled, earliest);

  const periods: { year: number; month: number; period: string }[] = [];
  for (const end = lastYear * 12 + lastMonth; cursor <= end; cursor++) {
    const year = Math.floor(cursor / 12);
    const month = cursor % 12;
    periods.push({ year, month, period: periodOf(year, month) });
  }
  return periods;
}
