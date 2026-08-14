import { WorkingHoursService } from "../working-hours/working-hours.service";

/**
 * Opening-hours containment.
 *
 * The rule this pins is the one the previous check got wrong: it asked whether
 * a session *overlapped* a window, so a session that started an hour before the
 * school opened was reported as fine because its tail landed inside. What
 * matters is containment, and the boundary cases (a session exactly filling a
 * window, or ending exactly as it closes) have to come out as inside rather
 * than out.
 */
describe("WorkingHoursService.checkContainment", () => {
  /** Windows are the only thing the containment check reads from the DB. */
  const serviceWith = (rows: Array<{ day_of_week: number | null; start_time: string; end_time: string }>) => {
    const db = {
      client: {
        query: {
          workingHours: {
            findMany: jest.fn().mockResolvedValue(
              rows.map((r) => ({ ...r, label: null, is_active: true })),
            ),
          },
        },
      },
    };
    return new WorkingHoursService(db as any, { record: jest.fn() } as any);
  };

  const MON = 2; // 0=Sat, so Monday is 2.
  const nineToFive = [{ day_of_week: null, start_time: "09:00", end_time: "17:00" }];

  it("reports a session fully inside as inside", async () => {
    const service = serviceWith(nineToFive);
    expect((await service.checkContainment(MON, "10:00", "11:30")).status).toBe("inside");
  });

  it("treats the exact window as inside, not as spilling over", async () => {
    const service = serviceWith(nineToFive);
    expect((await service.checkContainment(MON, "09:00", "17:00")).status).toBe("inside");
  });

  it("treats a session ending exactly at closing as inside", async () => {
    const service = serviceWith(nineToFive);
    expect((await service.checkContainment(MON, "16:00", "17:00")).status).toBe("inside");
  });

  it("treats a session starting exactly at opening as inside", async () => {
    const service = serviceWith(nineToFive);
    expect((await service.checkContainment(MON, "09:00", "10:00")).status).toBe("inside");
  });

  it("flags a session that starts before opening", async () => {
    const service = serviceWith(nineToFive);
    // The regression: this overlaps 09:00–17:00, so the old overlap-based
    // check called it fine.
    expect((await service.checkContainment(MON, "08:00", "10:00")).status).toBe("partial");
  });

  it("flags a session that runs past closing", async () => {
    const service = serviceWith(nineToFive);
    expect((await service.checkContainment(MON, "16:00", "18:00")).status).toBe("partial");
  });

  it("flags a session that swallows the whole window", async () => {
    const service = serviceWith(nineToFive);
    expect((await service.checkContainment(MON, "08:00", "18:00")).status).toBe("partial");
  });

  it("flags a session that misses every window entirely", async () => {
    const service = serviceWith(nineToFive);
    expect((await service.checkContainment(MON, "19:00", "20:00")).status).toBe("outside");
  });

  it("does not merge two windows across the gap between them", async () => {
    const service = serviceWith([
      { day_of_week: null, start_time: "09:00", end_time: "12:00" },
      { day_of_week: null, start_time: "14:00", end_time: "17:00" },
    ]);
    // 11:00–15:00 touches both, but the school is shut from 12:00 to 14:00.
    expect((await service.checkContainment(MON, "11:00", "15:00")).status).toBe("partial");
    // Each window on its own still admits a session.
    expect((await service.checkContainment(MON, "10:00", "11:00")).status).toBe("inside");
    expect((await service.checkContainment(MON, "14:30", "16:00")).status).toBe("inside");
  });

  it("lets a session through when no hours are configured", async () => {
    const service = serviceWith([]);
    // Nothing to judge against: the school has not declared its hours, so the
    // check must not invent a restriction.
    expect((await service.checkContainment(MON, "03:00", "04:00")).status).toBe("unconfigured");
  });

  it("prefers a day's own window over the every-day default", async () => {
    const service = serviceWith([
      { day_of_week: null, start_time: "09:00", end_time: "17:00" },
      { day_of_week: MON, start_time: "09:00", end_time: "12:00" },
    ]);
    // Monday closes at noon even though the default runs to 17:00.
    expect((await service.checkContainment(MON, "13:00", "14:00")).status).toBe("outside");
    // Another day still follows the default.
    expect((await service.checkContainment(3, "13:00", "14:00")).status).toBe("inside");
  });

  it("copes with the HH:MM:SS that Postgres time columns return", async () => {
    const service = serviceWith([{ day_of_week: null, start_time: "09:00:00", end_time: "17:00:00" }]);
    expect((await service.checkContainment(MON, "09:00", "17:00")).status).toBe("inside");
  });
});
