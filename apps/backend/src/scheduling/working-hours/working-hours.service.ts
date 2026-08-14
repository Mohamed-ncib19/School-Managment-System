import { BadRequestException, Injectable } from "@nestjs/common";
import { asc, eq, sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { workingHours } from "../../db/schema";
import { AuditService } from "../../audit/audit.service";
import { UpsertWorkingHoursDto } from "../dto/working-hours.dto";
import type { WorkingHour } from "../types";

export interface EffectiveWindow {
  day_of_week: number;
  start_time: string;
  end_time: string;
  label: string | null;
}

/**
 * The school's operating windows.
 *
 * Rows with a concrete `day_of_week` override the every-day default row(s)
 * (`day_of_week IS NULL`) for that day; any day without a specific row falls
 * back to the defaults. The calendar uses this to set its visible bounds and
 * business-hours shading, and new schedule rules get a soft warning when their
 * time slot falls entirely outside the resolved windows.
 */
@Injectable()
export class WorkingHoursService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<WorkingHour[]> {
    const rows = await this.db.client.query.workingHours.findMany({
      orderBy: [asc(workingHours.day_of_week), asc(workingHours.start_time)],
    });
    return rows.map((r) => ({
      id: r.id,
      day_of_week: r.day_of_week ?? null,
      label: r.label ?? null,
      start_time: r.start_time,
      end_time: r.end_time,
      is_active: r.is_active,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    })) as WorkingHour[];
  }

  /** Whether any window has ever been configured — drives the dashboard setup prompt. */
  async isEmpty(): Promise<boolean> {
    const [row] = await this.db.client
      .select({ count: sql<number>`count(*)::int` })
      .from(workingHours)
      .limit(1);
    return (row?.count ?? 0) === 0;
  }

  /**
   * Replaces the whole window set in one transaction (the settings UI edits the
   * entire week at once). Validates that no two effective windows overlap on the
   * same resolved day before committing.
   */
  async upsert(dto: UpsertWorkingHoursDto, userId?: string): Promise<WorkingHour[]> {
    if (dto.windows.length === 0) {
      // An empty set is a valid state (nothing configured yet) — wipe and return.
      await this.db.client.delete(workingHours);
      await this.audit.record({
        action: "schedule.working_hours.updated",
        entityType: "working_hours",
        entityId: null,
        entityLabel: "Working hours",
        actorId: userId,
        prevValues: { windows: await this.list() },
        newValues: { windows: [] },
      });
      return [];
    }

    for (const window of dto.windows) {
      if (window.start_time >= window.end_time) {
        throw new BadRequestException(
          `Window ${window.start_time}–${window.end_time} is invalid: end_time must be after start_time`,
        );
      }
    }

    const resolved = this.resolveWindows(
      dto.windows.map((w) => ({
        day_of_week: w.day_of_week ?? null,
        start_time: w.start_time,
        end_time: w.end_time,
        label: w.label ?? null,
      })),
    );
    const overlaps = this.findOverlaps(resolved);
    if (overlaps.length > 0) {
      throw new BadRequestException(
        `Overlapping working windows on day ${overlaps[0].day}: ${overlaps[0].a.start_time}–${overlaps[0].a.end_time} vs ${overlaps[0].b.start_time}–${overlaps[0].b.end_time}`,
      );
    }

    const created = await this.db.client.transaction(async (tx) => {
      await tx.delete(workingHours);
      return tx
        .insert(workingHours)
        .values(
          dto.windows.map((w) => ({
            day_of_week: w.day_of_week ?? null,
            label: w.label ?? null,
            start_time: w.start_time,
            end_time: w.end_time,
            is_active: w.is_active ?? true,
          })),
        )
        .returning();
    });

    await this.audit.record({
      action: "schedule.working_hours.updated",
      entityType: "working_hours",
      entityId: null,
      entityLabel: "Working hours",
      actorId: userId,
      prevValues: { windows_count: dto.windows.length === 0 ? 0 : undefined, windows: null },
      newValues: { windows: dto.windows },
    });

    return created.map((r) => ({
      id: r.id,
      day_of_week: r.day_of_week ?? null,
      label: r.label ?? null,
      start_time: r.start_time,
      end_time: r.end_time,
      is_active: r.is_active,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    })) as WorkingHour[];
  }

  /**
   * Resolved effective windows for a concrete day: specific-day rows when any
   * exist, otherwise the every-day defaults.
   */
  async getEffectiveHours(dayOfWeek: number): Promise<EffectiveWindow[]> {
    const rows = await this.db.client.query.workingHours.findMany({
      where: eq(workingHours.is_active, true),
    });
    return this.resolveWindows(
      rows.map((r) => ({
        day_of_week: r.day_of_week ?? null,
        start_time: r.start_time,
        end_time: r.end_time,
        label: r.label ?? null,
      })),
    )[dayOfWeek] ?? [];
  }

  /**
   * Soft validation for a proposed time slot: returns human-readable warnings
   * when the slot sits entirely outside the resolved working windows of its day
   * (a legitimate evening/makeup session must remain possible, so this never
   * blocks — it only surfaces a warning).
   */
  async validateSlot(dayOfWeek: number, startTime: string, endTime: string): Promise<string[]> {
    const { status, windows } = await this.checkContainment(dayOfWeek, startTime, endTime);
    if (status === "outside" || status === "partial") {
      return [`Outside configured working hours (${this.describeWindows(windows)})`];
    }
    return [];
  }

  /**
   * Whether a proposed window sits inside the school's opening hours.
   *
   * Distinct from `validateSlot`, which only ever asked whether the session
   * overlapped a window *at all*. A session from 08:00 to 10:00 against hours of
   * 09:00–17:00 overlaps, so it was reported as fine even though the first hour
   * happens with the school shut — the exact case an operator most needs told
   * about. Containment is the real question, so it is answered here and the
   * three outcomes are distinguished:
   *
   *  - `unconfigured` — no windows declared, so nothing can be judged and
   *    callers must let the session through rather than block on a rule the
   *    school has not set.
   *  - `inside` — fully within a single window.
   *  - `partial` — overlaps a window but spills past one or both of its edges.
   *  - `outside` — touches no window at all.
   *
   * A session must fit inside *one* window: two adjacent windows (09:00–12:00
   * and 14:00–17:00) do not combine into 09:00–17:00, because the gap between
   * them is precisely when the school is closed.
   */
  async checkContainment(
    dayOfWeek: number,
    startTime: string,
    endTime: string,
  ): Promise<{ status: "unconfigured" | "inside" | "partial" | "outside"; windows: EffectiveWindow[] }> {
    const windows = await this.getEffectiveHours(dayOfWeek);
    if (windows.length === 0) return { status: "unconfigured", windows };

    const start = this.normalize(startTime);
    const end = this.normalize(endTime);

    // Boundary-inclusive: a session running exactly 09:00–12:00 inside a
    // 09:00–12:00 window is in hours, not out of them.
    const contained = windows.some((w) => start >= this.normalize(w.start_time) && end <= this.normalize(w.end_time));
    if (contained) return { status: "inside", windows };

    const overlaps = windows.some((w) => start < this.normalize(w.end_time) && end > this.normalize(w.start_time));
    return { status: overlaps ? "partial" : "outside", windows };
  }

  /** "09:00–12:00, 14:00–17:00" — the windows as an operator reads them. */
  describeWindows(windows: EffectiveWindow[]): string {
    return windows.map((w) => `${this.normalize(w.start_time)}–${this.normalize(w.end_time)}`).join(", ");
  }

  /** `HH:MM`, dropping the seconds Postgres `time` columns come back with. */
  private normalize(time: string): string {
    return String(time).slice(0, 5);
  }

  /** Min start / max end across all resolved days — the calendar's visible bounds. */
  async bounds(): Promise<{ min: string; max: string } | null> {
    const rows = await this.db.client.query.workingHours.findMany({
      where: eq(workingHours.is_active, true),
    });
    const resolved = this.resolveWindows(
      rows.map((r) => ({
        day_of_week: r.day_of_week ?? null,
        start_time: r.start_time,
        end_time: r.end_time,
        label: r.label ?? null,
      })),
    );
    const all = Object.values(resolved).flat();
    if (all.length === 0) return null;
    const min = all.reduce((acc, w) => (w.start_time < acc ? w.start_time : acc), "23:59");
    const max = all.reduce((acc, w) => (w.end_time > acc ? w.end_time : acc), "00:00");
    return { min, max };
  }

  private timeToMinutes(t: string): number {
    const [h, m] = t.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  }

  private resolveWindows(rows: Array<{ day_of_week: number | null; start_time: string; end_time: string; label: string | null }>): Record<number, EffectiveWindow[]> {
    const specific: Record<number, EffectiveWindow[]> = {};
    const defaults: EffectiveWindow[] = [];
    for (const r of rows) {
      const window = { day_of_week: r.day_of_week ?? 0, start_time: r.start_time, end_time: r.end_time, label: r.label };
      if (r.day_of_week === null) defaults.push(window);
      else (specific[r.day_of_week] ??= []).push(window);
    }
    const out: Record<number, EffectiveWindow[]> = {};
    for (let day = 0; day <= 6; day++) {
      out[day] = (specific[day]?.length ? specific[day] : defaults)
        .map((w) => ({ ...w, day_of_week: day }))
        .sort((a, b) => this.timeToMinutes(a.start_time) - this.timeToMinutes(b.start_time));
    }
    return out;
  }

  private findOverlaps(resolved: Record<number, EffectiveWindow[]>): Array<{ day: number; a: EffectiveWindow; b: EffectiveWindow }> {
    const overlaps: Array<{ day: number; a: EffectiveWindow; b: EffectiveWindow }> = [];
    for (let day = 0; day <= 6; day++) {
      const windows = resolved[day] ?? [];
      for (let i = 0; i < windows.length; i++) {
        for (let j = i + 1; j < windows.length; j++) {
          const a = windows[i];
          const b = windows[j];
          if (a.start_time < b.end_time && b.start_time < a.end_time) {
            overlaps.push({ day, a, b });
          }
        }
      }
    }
    return overlaps;
  }
}