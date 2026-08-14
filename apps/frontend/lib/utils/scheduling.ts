import type { WorkingHourWindow } from "@/lib/api/scheduling.api";

/**
 * Client-side mirror of the scheduling rules the API enforces.
 *
 * The server is the authority — `syncTiles` refuses an out-of-hours session and
 * a double-booked room regardless of what the browser thinks — but a form that
 * only learns that on submit makes the operator guess. These give the same
 * answer immediately, so the field can explain itself while it is being typed.
 *
 * Keep the predicates identical to `WorkingHoursService.checkContainment` and
 * `ClassroomService.availability`: two validators that disagree are worse than
 * one, because the UI then either blocks something the API would accept or
 * promises something it will reject.
 */

export type WorkingHoursStatus = "unconfigured" | "inside" | "partial" | "outside";

export interface WorkingHoursResult {
  status: WorkingHoursStatus;
  /** The windows that apply to the day asked about, already resolved. */
  windows: Array<{ start_time: string; end_time: string }>;
}

/** `HH:MM` — Postgres `time` columns come back as `HH:MM:SS`. */
export function hhmm(time: string): string {
  return String(time).slice(0, 5);
}

/**
 * The windows in force on one weekday.
 *
 * A row with a concrete `day_of_week` overrides the every-day defaults
 * (`day_of_week === null`) for that day; a day with no specific row falls back
 * to the defaults. Same resolution the backend applies.
 */
export function windowsForDay(
  windows: WorkingHourWindow[] | undefined,
  dayOfWeek: number,
): Array<{ start_time: string; end_time: string }> {
  if (!windows?.length) return [];
  const active = windows.filter((w) => w.is_active !== false);
  const specific = active.filter((w) => w.day_of_week === dayOfWeek);
  const defaults = active.filter((w) => w.day_of_week === null || w.day_of_week === undefined);
  return (specific.length ? specific : defaults)
    .map((w) => ({ start_time: hhmm(w.start_time), end_time: hhmm(w.end_time) }))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
}

/**
 * Whether a proposed session fits inside the school's opening hours.
 *
 * Containment, not overlap: a session must sit inside a *single* window.
 * Adjacent windows do not merge — the gap between 09:00–12:00 and 14:00–17:00
 * is exactly when the school is shut, so 11:00–15:00 is not "inside hours"
 * merely because it touches both.
 *
 * Boundaries are inclusive: 09:00–12:00 inside a 09:00–12:00 window is in.
 */
export function checkWorkingHours(
  windows: WorkingHourWindow[] | undefined,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
): WorkingHoursResult {
  const dayWindows = windowsForDay(windows, dayOfWeek);
  if (dayWindows.length === 0) return { status: "unconfigured", windows: dayWindows };

  const start = hhmm(startTime);
  const end = hhmm(endTime);

  if (dayWindows.some((w) => start >= w.start_time && end <= w.end_time)) {
    return { status: "inside", windows: dayWindows };
  }
  const overlaps = dayWindows.some((w) => start < w.end_time && end > w.start_time);
  return { status: overlaps ? "partial" : "outside", windows: dayWindows };
}

/** "09:00–12:00, 14:00–17:00" — the windows as an operator reads them. */
export function describeWindows(windows: Array<{ start_time: string; end_time: string }>): string {
  return windows.map((w) => `${w.start_time}–${w.end_time}`).join(", ");
}

/**
 * Do two time ranges overlap?
 *
 * Half-open on purpose, matching the SQL the conflict scan runs
 * (`a.start < b.end AND a.end > b.start`). It is true for a partial overlap at
 * either end, for one range wholly containing the other, and for two identical
 * ranges; it is false when one ends exactly as the other begins, which is a
 * back-to-back session and not a clash.
 */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return hhmm(aStart) < hhmm(bEnd) && hhmm(aEnd) > hhmm(bStart);
}

/** Whether `end` is strictly after `start`, both `HH:MM`. */
export function isValidRange(startTime: string, endTime: string): boolean {
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!timePattern.test(startTime) || !timePattern.test(endTime)) return false;
  return endTime > startTime;
}

/**
 * The next calendar date falling on a school weekday (0=Sat … 6=Fri).
 *
 * Availability is asked about a concrete date, because which rules are in force
 * depends on their effective range — but the builder edits a *weekly* pattern
 * with no date of its own. The soonest matching day (today included) is the one
 * the operator is about to schedule into, so it is the right one to check.
 *
 * `+ 1` converts a JS weekday to the school numbering; see `date.util.ts` on
 * the backend for why the inverse rotation is not the same one.
 */
export function nextDateForSchoolDay(dayOfWeek: number, from: Date = new Date()): string {
  const cursor = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()));
  for (let i = 0; i < 7; i++) {
    if ((cursor.getUTCDay() + 1) % 7 === dayOfWeek) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return cursor.toISOString().slice(0, 10);
}

/** "1h30", "45min" — the length of a session, for a form that shows two times. */
export function durationLabel(startTime: string, endTime: string): string | null {
  if (!isValidRange(startTime, endTime)) return null;
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const minutes = eh * 60 + em - (sh * 60 + sm);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}min`;
  return rest > 0 ? `${hours}h${String(rest).padStart(2, "0")}` : `${hours}h`;
}
