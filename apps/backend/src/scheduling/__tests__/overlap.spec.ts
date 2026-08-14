/**
 * The overlap predicate, stated once and pinned here.
 *
 * Every layer of the scheduling stack asks the same question — the conflict
 * scan's SQL, the classroom availability query, and the browser-side mirror in
 * `lib/utils/scheduling.ts` — and they must all answer it identically, because
 * a room that the UI calls free and the API calls taken is worse than either
 * answer alone. The shape is `a.start < b.end AND a.end > b.start`.
 */
function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && aEnd > bStart;
}

describe("session overlap", () => {
  const EXISTING = ["10:00", "11:30"] as const;
  const against = (start: string, end: string) => rangesOverlap(start, end, EXISTING[0], EXISTING[1]);

  it("catches an identical window", () => {
    expect(against("10:00", "11:30")).toBe(true);
  });

  it("catches a partial overlap at the start", () => {
    expect(against("09:00", "10:30")).toBe(true);
  });

  it("catches a partial overlap at the end", () => {
    expect(against("11:00", "12:00")).toBe(true);
  });

  it("catches a proposal wholly inside the existing session", () => {
    expect(against("10:30", "11:00")).toBe(true);
  });

  it("catches a proposal that wholly contains the existing session", () => {
    expect(against("09:00", "13:00")).toBe(true);
  });

  it("catches a one-minute clip at either edge", () => {
    expect(against("09:00", "10:01")).toBe(true);
    expect(against("11:29", "12:00")).toBe(true);
  });

  it("allows a session ending exactly when the existing one starts", () => {
    // Back-to-back, not a clash: the room is free the instant the first ends.
    expect(against("08:30", "10:00")).toBe(false);
  });

  it("allows a session starting exactly when the existing one ends", () => {
    expect(against("11:30", "13:00")).toBe(false);
  });

  it("allows windows that do not touch at all", () => {
    expect(against("07:00", "08:00")).toBe(false);
    expect(against("14:00", "15:00")).toBe(false);
  });

  it("is symmetric — order of the two ranges cannot change the answer", () => {
    const cases: Array<[string, string, string, string]> = [
      ["10:00", "11:30", "10:00", "11:30"],
      ["09:00", "10:30", "10:00", "11:30"],
      ["11:30", "13:00", "10:00", "11:30"],
      ["09:00", "13:00", "10:00", "11:30"],
      ["07:00", "08:00", "10:00", "11:30"],
    ];
    for (const [aStart, aEnd, bStart, bEnd] of cases) {
      expect(rangesOverlap(aStart, aEnd, bStart, bEnd)).toBe(rangesOverlap(bStart, bEnd, aStart, aEnd));
    }
  });

  it("handles a run of sessions, flagging only the ones that actually clash", () => {
    const day = [
      ["08:00", "09:00"],
      ["09:00", "10:30"],
      ["10:30", "12:00"],
      ["13:00", "14:00"],
    ];
    const proposed = ["10:00", "11:00"];
    const clashing = day.filter(([s, e]) => rangesOverlap(proposed[0], proposed[1], s, e));
    // Straddles the 09:00–10:30 and 10:30–12:00 sessions, and nothing else.
    expect(clashing).toEqual([
      ["09:00", "10:30"],
      ["10:30", "12:00"],
    ]);
  });
});
