/**
 * Date-range and bucketing arithmetic for every financial time series.
 *
 * All of it works in UTC, for the same reason `billing.util.ts` does: the
 * ledger's `paid_at` and the invoices' `due_date` are UTC instants, and building
 * a boundary with the local `new Date(y, m, d)` constructor would shift it a day
 * for any server east of Greenwich — quietly moving a payment made on the 1st
 * into the previous month's revenue.
 */

export type Granularity = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

export const GRANULARITIES: Granularity[] = ["daily", "weekly", "monthly", "quarterly", "yearly"];

export interface DateRange {
  from: Date;
  to: Date;
}

/** `YYYY-MM` for a UTC instant. */
export function periodOfDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Parses `YYYY-MM` into its UTC year and 0-indexed month. */
export function parsePeriod(period: string): { year: number; month: number } {
  const [year, month] = period.split("-").map(Number);
  return { year, month: month - 1 };
}

export function startOfMonthUTC(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
}

/** Inclusive end: the last millisecond of the month, so `lte` catches everything. */
export function endOfMonthUTC(year: number, month: number): Date {
  return new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
}

export function startOfDayUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

export function endOfDayUTC(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  );
}

/**
 * Accepts `YYYY-MM-DD` or a full ISO instant.
 *
 * A bare date as the *end* of a range means "through the end of that day",
 * otherwise a filter of 1st-31st silently drops everything collected on the 31st.
 */
export function parseBoundary(value: string, kind: "from" | "to"): Date | null {
  if (!value) return null;
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(bare ? `${value}T00:00:00.000Z` : value);
  if (isNaN(parsed.getTime())) return null;
  if (bare && kind === "to") return endOfDayUTC(parsed);
  return parsed;
}

/** The months a range covers, as `YYYY-MM` labels. */
export function periodsInRange(range: DateRange): string[] {
  const periods: string[] = [];
  let cursor = range.from.getUTCFullYear() * 12 + range.from.getUTCMonth();
  const end = range.to.getUTCFullYear() * 12 + range.to.getUTCMonth();
  // Guard against a reversed or absurd range producing an unbounded array.
  const limit = Math.min(end, cursor + 600);
  for (; cursor <= limit; cursor++) {
    periods.push(`${Math.floor(cursor / 12)}-${String((cursor % 12) + 1).padStart(2, "0")}`);
  }
  return periods;
}

/**
 * The academic year containing `date`, given the month it starts in.
 *
 * With a September start, 2026-09-01 through 2027-08-31 is the "2026/27" year;
 * anything in January 2027 belongs to the year that began the previous autumn.
 */
export function academicYearRange(date: Date, startMonth: number): DateRange & { label: string } {
  const zeroIndexedStart = startMonth - 1;
  const year =
    date.getUTCMonth() >= zeroIndexedStart ? date.getUTCFullYear() : date.getUTCFullYear() - 1;

  return {
    from: startOfMonthUTC(year, zeroIndexedStart),
    to: endOfMonthUTC(year + 1, zeroIndexedStart - 1),
    label: `${year}/${String(year + 1).slice(-2)}`,
  };
}

/** Monday-based week start, matching how the academy reads a calendar. */
export function startOfWeekUTC(date: Date): Date {
  const day = date.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  const monday = new Date(date);
  monday.setUTCDate(monday.getUTCDate() - offset);
  return startOfDayUTC(monday);
}

/**
 * The bucket key a date falls into, for a given granularity.
 *
 * Keys sort lexicographically in chronological order, which is what lets a
 * series be assembled with a plain `Map` and sorted without parsing anything.
 */
export function bucketKey(date: Date, granularity: Granularity): string {
  const year = date.getUTCFullYear();

  switch (granularity) {
    case "daily":
      return `${year}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    case "weekly": {
      const monday = startOfWeekUTC(date);
      return `${monday.getUTCFullYear()}-W${String(isoWeek(monday)).padStart(2, "0")}`;
    }
    case "quarterly":
      return `${year}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
    case "yearly":
      return String(year);
    case "monthly":
    default:
      return `${year}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }
}

/** ISO-8601 week number, so week labels agree with the rest of the world. */
function isoWeek(date: Date): number {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = target.getUTCDay() === 0 ? 7 : target.getUTCDay();
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/**
 * Every bucket a range spans, including the empty ones.
 *
 * A chart that omits months with no collections draws a straight line between
 * the two sides of a quiet summer, which reads as steady income rather than
 * none. The series has to carry the zeroes.
 */
export function bucketsInRange(range: DateRange, granularity: Granularity): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const cursor = new Date(range.from);
  // Bounded so a mistyped range cannot spin here.
  for (let guard = 0; cursor <= range.to && guard < 4000; guard++) {
    const key = bucketKey(cursor, granularity);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    switch (granularity) {
      case "daily":
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        break;
      case "weekly":
        cursor.setUTCDate(cursor.getUTCDate() + 7);
        break;
      case "quarterly":
        cursor.setUTCMonth(cursor.getUTCMonth() + 3);
        break;
      case "yearly":
        cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
        break;
      default:
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  return keys;
}

/** Named ranges behind the dashboard's quick filters. */
export function quickRange(
  name: string,
  now: Date,
  academicYearStartMonth: number,
): DateRange | null {
  const today = startOfDayUTC(now);

  switch (name) {
    case "today":
      return { from: today, to: endOfDayUTC(now) };
    case "this_week":
      return { from: startOfWeekUTC(now), to: endOfDayUTC(now) };
    case "this_month":
      return {
        from: startOfMonthUTC(now.getUTCFullYear(), now.getUTCMonth()),
        to: endOfMonthUTC(now.getUTCFullYear(), now.getUTCMonth()),
      };
    case "last_month": {
      const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      return {
        from: startOfMonthUTC(previous.getUTCFullYear(), previous.getUTCMonth()),
        to: endOfMonthUTC(previous.getUTCFullYear(), previous.getUTCMonth()),
      };
    }
    case "this_year":
      return {
        from: startOfMonthUTC(now.getUTCFullYear(), 0),
        to: endOfMonthUTC(now.getUTCFullYear(), 11),
      };
    case "academic_year":
      return academicYearRange(now, academicYearStartMonth);
    default:
      return null;
  }
}

/**
 * Sensible default window per granularity, used when a caller asks for a series
 * without saying over what span: twelve months of a monthly chart, thirty days
 * of a daily one.
 */
export function defaultRangeFor(granularity: Granularity, now: Date): DateRange {
  const to = endOfDayUTC(now);
  const from = new Date(now);

  switch (granularity) {
    case "daily":
      from.setUTCDate(from.getUTCDate() - 29);
      break;
    case "weekly":
      from.setUTCDate(from.getUTCDate() - 7 * 11);
      break;
    case "quarterly":
      from.setUTCMonth(from.getUTCMonth() - 21);
      break;
    case "yearly":
      from.setUTCFullYear(from.getUTCFullYear() - 4);
      break;
    default:
      from.setUTCMonth(from.getUTCMonth() - 11);
  }

  return { from: startOfDayUTC(from), to };
}
