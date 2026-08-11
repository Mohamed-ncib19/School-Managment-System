import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { groups } from "../db/schema";
import {
  AttendanceContext,
  AttendanceSession,
  AttendanceStudent,
  WeeklyPattern,
} from "./attendance.types";

/**
 * How many sessions a month defaults to — the academy's two sessions a week.
 *
 * This is deliberately a parameter, not a hardcoded loop bound: every method
 * here accepts the count it should aim for, so a future academy using 6, 10 or
 * any other number only changes a call site, never the logic.
 */
export const DEFAULT_SESSIONS_PER_MONTH = 8;

/** Lowercase -> ISO weekday (1 = Monday … 7 = Sunday). English and French. */
const WEEKDAYS: Record<string, number> = {
  mon: 1, monday: 1, lundi: 1,
  tue: 2, tues: 2, tuesday: 2, mardi: 2,
  wed: 3, wednesday: 3, mercredi: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, jeudi: 4,
  fri: 5, friday: 5, vendredi: 5,
  sat: 6, saturday: 6, samedi: 6,
  sun: 7, sunday: 7, dimanche: 7,
};

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

/**
 * Builds the frozen snapshot a monthly attendance register is printed from.
 *
 * The academic context is resolved once (group → professor → field → level and
 * the active roster) and the teaching sessions are then laid out over the
 * month: the group's weekly schedule decides which weekdays get a séance, with
 * a configurable target count (8 by default). If the schedule cannot be read
 * as weekdays — a typo, a free-text note — the sessions fall back to the most
 * even spread across the month instead of failing or inventing days.
 */
@Injectable()
export class AttendanceGenerationService {
  constructor(private readonly db: DbService) {}

  /** The full context one register is generated from, in one pass. */
  async generate(groupId: string, month: number, year: number, sessionsCount = DEFAULT_SESSIONS_PER_MONTH): Promise<AttendanceContext> {
    if (month < 1 || month > 12) throw new BadRequestException("le mois doit être compris entre 1 et 12");
    if (year < 2000) throw new BadRequestException("l'année doit être supérieure ou égale à 2000");
    if (sessionsCount < 1 || sessionsCount > 31) {
      throw new BadRequestException("sessions_count doit être compris entre 1 et 31");
    }

    const group = await this.db.client.query.groups.findFirst({
      where: eq(groups.id, groupId),
      with: {
        professor: { with: { field: { with: { level: true } } } },
        assignments: {
          with: {
            student: {
              columns: { id: true, first_name: true, last_name: true, phone: true, parent_phone: true, status: true },
            },
          },
        },
      },
    });
    if (!group) throw new NotFoundException(`Groupe ${groupId} introuvable`);

    const professor = group.professor;
    const students: AttendanceStudent[] = group.assignments
      .map((a) => a.student)
      .filter((s) => s.status === "active")
      .map(({ status: _status, ...rest }) => rest)
      .sort((a, b) =>
        `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, "fr"),
      );

    const weekly = group.schedule_notes ? this.parseWeekly(group.schedule_notes) : null;

    return {
      group_id: group.id,
      group_name: group.name,
      professor_id: professor?.id ?? null,
      professor_name: professor?.full_name ?? "—",
      level_name: professor?.field?.level?.name ?? "—",
      field_name: professor?.field?.name ?? null,
      month,
      year,
      academic_year: this.academicYear(year, month),
      schedule: group.schedule_notes,
      weekly,
      students,
      sessions: this.buildSessions(sessionsCount),
    };
  }

  /**
   * Splits the schedule notes into weekday numbers, understanding both English
   * and French day names plus common separators:
   * "Monday 16:00 → 18:00 / Wednesday 14:00 → 16:00",
   * "Mardi et Jeudi 10h-12h", "Mon-Thu", "Samedi 9h-11h".
   */
  parseWeekly(notes: string): WeeklyPattern | null {
    const tokens = notes
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean);

    const found = new Set<number>();
    for (const token of tokens) {
      const iso = WEEKDAYS[token];
      if (iso) found.add(iso);
    }

    if (found.size === 0) return null;
    return {
      days: [...found].sort((a, b) => a - b),
      description: notes.trim(),
    };
  }

  /**
   * The sessions of the register — just the identifiers, one per column.
   *
   * The register is a handwritten sheet: the teacher marks presence in the
   * columns by hand, so no dates are attached and no calendar logic is
   * involved. The count stays fully configurable (8 by default) — a future
   * academy using 6, 10 or any other number only changes a call site, never
   * this method.
   */
  buildSessions(count: number): AttendanceSession[] {
    const wanted = Math.min(Math.max(1, count), 31);
    return Array.from({ length: wanted }, () => ({ id: randomUUID() }));
  }

  /** Academic year label for a month, e.g. September 2025 → "2025/26". */
  private academicYear(year: number, month: number): string {
    const start = month >= 9 ? year : year - 1;
    return `${start}/${String(start + 1).slice(-2)}`;
  }
}

/** French labels used by generation callers (banner, header). */
export const MONTH_NAMES = MONTHS_FR;
