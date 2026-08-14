/**
 * Calendar arithmetic shared by the scheduling services.
 *
 * These are pure functions with no dependency on the database or on Nest, and
 * they live in their own file rather than beside one of the services because
 * more than one service needs them: `ConflictService` importing them out of
 * `OccurrenceService` would have made a service depend on a sibling service's
 * module purely for a date rotation, which is exactly the kind of edge that
 * turns into an import cycle later.
 *
 * Every date here is a bare `YYYY-MM-DD` string interpreted at UTC midnight.
 * Nothing in the timetable has a timezone: a session on the 15th is on the 15th
 * regardless of where it is read, and going through UTC consistently is what
 * stops a local-time offset from moving a session to the previous evening.
 */

/** A `Date` or ISO timestamp narrowed to its `YYYY-MM-DD` day. */
export function dateString(d: Date | string): string {
  return typeof d === "string" ? d.split("T")[0] : d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The first date on or after `date` that falls on `isoDay` (JS getUTCDay). */
export function firstWeekdayOnOrAfter(date: string, isoDay: number): string {
  const delta = (isoDay - new Date(date + "T00:00:00Z").getUTCDay() + 7) % 7;
  return delta === 0 ? date : addDays(date, delta);
}

/**
 * How many times `isoDay` occurs in the inclusive range — the weekly count in
 * closed form, so counting a year costs the same as counting a week.
 */
export function weekdayCountBetween(start: string, end: string, isoDay: number): number {
  const first = firstWeekdayOnOrAfter(start, isoDay);
  if (first > end) return 0;
  const span = (Date.parse(end + "T00:00:00Z") - Date.parse(first + "T00:00:00Z")) / 86_400_000;
  return Math.floor(span / 7) + 1;
}

/**
 * The two weekday numberings, and the rotations between them.
 *
 * `time_slots.day_of_week` counts from Saturday (the Tunisian school week) and
 * `Date#getUTCDay` counts from Sunday, so converting is `+6` one way and `+1`
 * the other. Both directions are defined here, together, because using one
 * where the other belongs is a silent failure: `(day + 6) % 7` is a
 * plausible-looking rotation whichever way it is read, it typechecks either
 * way, and applied backwards it is wrong on all seven days — landing two days
 * out rather than adjacent, so checking a single date does not reveal it.
 * `ConflictService` shipped that inversion and scanned the wrong weekday
 * entirely; `occurrence-dates.spec.ts` now pins both directions.
 */

/** 0=Sat…6=Fri (Tunisian school week) → JS getUTCDay. */
export function isoDayOfWeek(dayOfWeek: number): number {
  return (dayOfWeek + 6) % 7;
}

/** JS getUTCDay → 0=Sat…6=Fri. The inverse of `isoDayOfWeek`. */
export function schoolDayOfWeek(isoDay: number): number {
  return (isoDay + 1) % 7;
}

/** `time_slots.day_of_week` for a `YYYY-MM-DD` date. */
export function schoolDayOfDate(date: string): number {
  return schoolDayOfWeek(new Date(date + "T00:00:00Z").getUTCDay());
}
