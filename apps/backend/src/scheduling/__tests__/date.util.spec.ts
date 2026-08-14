import {
  addDays,
  firstWeekdayOnOrAfter,
  isoDayOfWeek,
  schoolDayOfDate,
  schoolDayOfWeek,
  weekdayCountBetween,
} from "../date.util";

/**
 * The date arithmetic behind the timetable.
 *
 * Two things are pinned here, both of which have already gone wrong once:
 *
 *  1. The weekday rotations. `time_slots.day_of_week` counts from Saturday and
 *     `Date#getUTCDay` counts from Sunday, so converting between them is `+6`
 *     one way and `+1` the other. Applying the `+6` form in the JS→school
 *     direction reads as plausible and typechecks, but is wrong on all seven
 *     days — it lands two days out, never adjacent, so no spot-check of a
 *     single date catches it. `conflict.service.ts` shipped that inversion and
 *     the Layer-2 conflict check scanned the wrong weekday entirely.
 *
 *  2. The closed-form occurrence walk. `firstWeekdayOnOrAfter` + a 7-day stride
 *     replaced a day-by-day loop, and `weekdayCountBetween` replaced counting
 *     that loop's hits. Both are checked against the loop they replaced rather
 *     than against hand-written expectations, so the property under test is
 *     "identical to the original", which is the actual requirement.
 */

const SCHOOL = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"] as const;
const JS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** The day-by-day scan the strided walk replaced. */
function bruteForceDates(start: string, end: string, isoDay: number): string[] {
  const out: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    if (new Date(cursor + "T00:00:00Z").getUTCDay() === isoDay) out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** The strided walk `generateOccurrences` actually runs. */
function stridedDates(start: string, end: string, isoDay: number): string[] {
  const out: string[] = [];
  let cursor = firstWeekdayOnOrAfter(start, isoDay);
  while (cursor <= end) {
    out.push(cursor);
    cursor = addDays(cursor, 7);
  }
  return out;
}

describe("weekday rotations", () => {
  it("maps every school weekday to the matching JS weekday", () => {
    for (let dow = 0; dow < 7; dow++) {
      expect(JS[isoDayOfWeek(dow)]).toBe(SCHOOL[dow]);
    }
  });

  it("maps every JS weekday back to the matching school weekday", () => {
    for (let js = 0; js < 7; js++) {
      expect(SCHOOL[schoolDayOfWeek(js)]).toBe(JS[js]);
    }
  });

  it("round-trips in both directions", () => {
    for (let dow = 0; dow < 7; dow++) expect(schoolDayOfWeek(isoDayOfWeek(dow))).toBe(dow);
    for (let js = 0; js < 7; js++) expect(isoDayOfWeek(schoolDayOfWeek(js))).toBe(js);
  });

  it("is not the forward rotation applied backwards", () => {
    // The exact bug: `(getUTCDay() + 6) % 7` used as the inverse. It must
    // disagree with the real inverse on every single day, so a test that only
    // sampled one weekday would have passed either way.
    for (let js = 0; js < 7; js++) {
      expect(schoolDayOfWeek(js)).not.toBe((js + 6) % 7);
    }
  });

  it("resolves known calendar dates (2026-08-15 is a Saturday)", () => {
    expect(SCHOOL[schoolDayOfDate("2026-08-15")]).toBe("Sat");
    expect(SCHOOL[schoolDayOfDate("2026-08-16")]).toBe("Sun");
    expect(SCHOOL[schoolDayOfDate("2026-08-17")]).toBe("Mon");
    expect(SCHOOL[schoolDayOfDate("2026-08-21")]).toBe("Fri");
  });

  it("agrees with schoolDayOfWeek for every date in a full week", () => {
    for (let i = 0; i < 7; i++) {
      const date = addDays("2026-08-15", i);
      expect(schoolDayOfDate(date)).toBe(schoolDayOfWeek(new Date(date + "T00:00:00Z").getUTCDay()));
    }
  });
});

describe("occurrence walk", () => {
  it("strides the same dates the day-by-day scan found", () => {
    for (let isoDay = 0; isoDay < 7; isoDay++) {
      // A range that starts on each weekday in turn, so the "first match" is
      // sometimes the start date itself and sometimes up to six days later.
      for (let offset = 0; offset < 7; offset++) {
        const start = addDays("2026-01-01", offset);
        const end = addDays(start, 60);
        expect(stridedDates(start, end, isoDay)).toEqual(bruteForceDates(start, end, isoDay));
      }
    }
  });

  it("counts what the scan counts", () => {
    for (let isoDay = 0; isoDay < 7; isoDay++) {
      for (const [start, end] of [
        ["2026-08-15", "2026-08-15"], // single day
        ["2026-08-15", "2026-08-21"], // exactly one week
        ["2026-12-28", "2027-01-04"], // across a year boundary
        ["2024-02-26", "2024-03-04"], // across a leap day
        ["2026-02-26", "2026-03-04"], // across a non-leap February
        ["2026-01-01", "2026-12-31"], // a full year
      ]) {
        expect(weekdayCountBetween(start, end, isoDay)).toBe(bruteForceDates(start, end, isoDay).length);
      }
    }
  });

  it("returns zero when the range contains no matching weekday", () => {
    // Tue 2026-08-18 → Thu 2026-08-20 contains no Saturday.
    expect(weekdayCountBetween("2026-08-18", "2026-08-20", isoDayOfWeek(0))).toBe(0);
  });

  it("matches the scan across randomised ranges", () => {
    const epoch = Date.parse("2024-01-01T00:00:00Z");
    for (let i = 0; i < 300; i++) {
      const start = new Date(epoch + Math.floor(Math.random() * 900) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const end = addDays(start, Math.floor(Math.random() * 420));
      const isoDay = Math.floor(Math.random() * 7);
      expect(weekdayCountBetween(start, end, isoDay)).toBe(bruteForceDates(start, end, isoDay).length);
      expect(stridedDates(start, end, isoDay)).toEqual(bruteForceDates(start, end, isoDay));
    }
  });
});
