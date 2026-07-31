/**
 * Billing-date arithmetic, shared by every generator so a due date means the
 * same thing however the row was created.
 *
 * Everything here works in UTC. `enrollment_date` is stored as a UTC midnight
 * (see StudentsService.parseDate), and building the due date with the local
 * `new Date(y, m, d)` constructor instead would shift it a day backwards for
 * any server east of Greenwich — a 28th due date persisted as `…-27T23:00:00Z`.
 */

/** Last calendar day of a UTC month. `month` is 0-indexed. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The `YYYY-MM` period label for a UTC year/month pair. `month` is 0-indexed. */
export function periodOf(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/**
 * Billing day is the enrollment anniversary, clamped to the last valid day of
 * the target month: a student enrolled on the 31st bills the 30th in April and
 * the 28th in a non-leap February, but still the 31st in a 31-day month.
 */
export function dueDateFor(enrollmentDate: Date, year: number, month: number): Date {
  const day = Math.min(enrollmentDate.getUTCDate(), daysInMonth(year, month));
  return new Date(Date.UTC(year, month, day));
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
