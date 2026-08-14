import { Injectable } from "@nestjs/common";
import { and, eq, gte, inArray, lte, or, SQL, sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { classrooms, professors, scheduleEntries, scheduleEntryExceptions, studentScheduleExceptions, timeSlots } from "../../db/schema";
import type { Occurrence, ScheduleEntryException, StudentScheduleException } from "../types";
import {
  addDays,
  dateString,
  firstWeekdayOnOrAfter,
  isoDayOfWeek,
  weekdayCountBetween,
} from "../date.util";

export interface OccurrenceFilters {
  groupId?: string;
  profId?: string;
  classroomId?: string;
  fieldId?: string;
  levelId?: string;
  studentId?: string;
  search?: string;
}

/** A rule row pre-loaded with everything the expansion needs. */
interface RuleRow {
  id: string;
  group_id: string;
  time_slot_id: string;
  classroom_id: string | null;
  prof_id: string;
  subject: string | null;
  notes: string | null;
  effective_from: Date;
  effective_until: Date | null;
  group: {
    id: string;
    name: string;
    color: string | null;
    field: { id: string; name: string; color: string | null } | null;
  };
  time_slot: { id: string; label: string; day_of_week: number; start_time: string; end_time: string };
  classroom: { id: string; name: string; color: string | null; room_number: string | null } | null;
  professor: { id: string; full_name: string; color: string | null };
}

interface ReferenceEntities {
  professors: Map<string, { id: string; full_name: string; color: string | null }>;
  classrooms: Map<string, { id: string; name: string; color: string | null; room_number: string | null }>;
  timeSlots: Map<string, { id: string; day_of_week: number; start_time: string; end_time: string }>;
}

// The calendar arithmetic now lives in `../date.util`, where ConflictService
// can reach it without importing this service. Re-exported so the existing
// callers of these names keep working unchanged.
export {
  addDays,
  dateString,
  firstWeekdayOnOrAfter,
  isoDayOfWeek,
  schoolDayOfDate,
  schoolDayOfWeek,
  weekdayCountBetween,
} from "../date.util";

/**
 * The occurrence engine: turns recurring `schedule_entries` rules plus their
 * exceptions into a flat, date-bounded list of concrete sessions.
 *
 * FullCalendar never sees recurrence or exception state — it only renders what
 * this service returns. Every call is bounded to a visible date range, so the
 * expansion stays cheap regardless of how many open-ended rules exist.
 */
@Injectable()
export class OccurrenceService {
  constructor(private readonly db: DbService) {}

  async generateOccurrences(filters: OccurrenceFilters, fromDate: string, toDate: string): Promise<Occurrence[]> {
    const rules = await this.loadRules(filters, fromDate, toDate);
    if (rules.length === 0) return [];

    const ruleIds = rules.map((r) => r.id);
    const [exceptions, studentExceptions] = await Promise.all([
      this.loadEntryExceptions(ruleIds, fromDate, toDate),
      filters.studentId ? this.loadStudentExceptions(filters.studentId, ruleIds, fromDate, toDate) : Promise.resolve([]),
    ]);
    const entryMap = new Map(exceptions.map((e) => [`${e.schedule_entry_id}::${e.occurrence_date}`, e]));
    const studentMap = new Map(studentExceptions.map((e) => [`${e.schedule_entry_id}::${e.exception_date}`, e]));
    const reference = await this.loadReferenceEntities(exceptions);

    const occurrences: Occurrence[] = [];
    for (const rule of rules) {
      const start = maxStr(rule.effective_from, fromDate);
      const end = minStr(rule.effective_until, toDate);
      if (start > end) continue;

      // A weekly rule meets on one weekday, so the walk lands on the first
      // matching date and then strides seven days at a time. Testing every
      // date in the range instead parsed six dates per hit and threw them
      // away — on a year view that is hundreds of thousands of wasted `Date`
      // constructions before a single occurrence is built.
      const isoDay = isoDayOfWeek(rule.time_slot.day_of_week);
      let cursor = firstWeekdayOnOrAfter(start, isoDay);
      while (cursor <= end) {
        const occurrence = this.baseOccurrence(rule, cursor);
        const entryException = entryMap.get(`${rule.id}::${cursor}`);
        if (entryException) this.applyEntryException(occurrence, entryException, reference);

        const studentException = studentMap.get(`${rule.id}::${cursor}`);
        if (studentException) this.applyStudentException(occurrence, studentException);

        occurrences.push(occurrence);
        if (studentException?.exception_type === "makeup") {
          occurrences.push(this.makeupOccurrence(rule, studentException));
        }
        cursor = addDays(cursor, 7);
      }
    }

    return occurrences.sort(compareByDateThenTime);
  }

  /**
   * Count of occurrences in a range — used by the overview dashboard.
   *
   * Deliberately not `generateOccurrences(...).length`: the dashboard wants one
   * integer, and building the objects to count them meant loading every rule
   * with its group, field, classroom and professor attached — two megabytes of
   * joined rows discarded immediately. This reads three columns per rule and
   * closes the form for the weekday count, so the cost no longer scales with
   * the length of the range at all.
   *
   * It agrees with `generateOccurrences(...).length` only because this count is
   * unfiltered. `makeup` student exceptions add a synthetic occurrence there,
   * and those are loaded only when `filters.studentId` is set — which it never
   * is here. Giving this method filters would break that equality (which
   * `scripts/verify-scheduling.mjs` asserts) unless makeups are added back in.
   */
  async countOccurrences(fromDate: string, toDate: string): Promise<number> {
    const spans = await this.loadRuleSpans(fromDate, toDate);
    let count = 0;
    for (const span of spans) {
      const start = maxStr(span.effective_from, fromDate);
      const end = minStr(span.effective_until, toDate);
      if (start > end) continue;
      count += weekdayCountBetween(start, end, isoDayOfWeek(span.day_of_week));
    }
    return count;
  }

  /** Just the three columns the occurrence count needs, for rules in range. */
  private async loadRuleSpans(fromDate: string, toDate: string) {
    return this.db.client
      .select({
        effective_from: scheduleEntries.effective_from,
        effective_until: scheduleEntries.effective_until,
        day_of_week: timeSlots.day_of_week,
      })
      .from(scheduleEntries)
      .innerJoin(timeSlots, eq(timeSlots.id, scheduleEntries.time_slot_id))
      .where(
        and(
          eq(scheduleEntries.is_active, true),
          lte(scheduleEntries.effective_from, new Date(toDate + "T23:59:59.999Z")),
          or(
            sql`${scheduleEntries.effective_until} IS NULL`,
            gte(scheduleEntries.effective_until, new Date(fromDate + "T00:00:00Z")),
          ) as SQL,
        ),
      );
  }

  private async loadRules(filters: OccurrenceFilters, fromDate: string, toDate: string): Promise<RuleRow[]> {
    const clauses: SQL[] = [eq(scheduleEntries.is_active, true)];
    if (filters.groupId) clauses.push(eq(scheduleEntries.group_id, filters.groupId));
    if (filters.profId) clauses.push(eq(scheduleEntries.prof_id, filters.profId));
    if (filters.classroomId) clauses.push(eq(scheduleEntries.classroom_id, filters.classroomId));

    // Date-range overlap: the rule must be active at some point inside [from, to].
    clauses.push(lte(scheduleEntries.effective_from, new Date(toDate + "T23:59:59.999Z")));
    clauses.push(
      or(
        sql`${scheduleEntries.effective_until} IS NULL`,
        gte(scheduleEntries.effective_until, new Date(fromDate + "T00:00:00Z")),
      ) as SQL,
    );

    // The academic chain, the student's enrolments and the search term are all
    // resolved in the WHERE clause rather than by loading every active rule and
    // discarding most of them in Node. `fieldId`/`levelId` walk the group's
    // owning professor, exactly as the JS filter did.
    if (filters.fieldId) {
      clauses.push(
        sql`exists(select 1 from groups g join professors p on p.id = g.prof_id
                   where g.id = ${scheduleEntries.group_id} and p.field_id = ${filters.fieldId})` as SQL,
      );
    }
    if (filters.levelId) {
      clauses.push(
        sql`exists(select 1 from groups g join professors p on p.id = g.prof_id join fields f on f.id = p.field_id
                   where g.id = ${scheduleEntries.group_id} and f.level_id = ${filters.levelId})` as SQL,
      );
    }
    if (filters.studentId) {
      clauses.push(
        sql`exists(select 1 from student_assignments sa
                   where sa.group_id = ${scheduleEntries.group_id} and sa.student_id = ${filters.studentId})` as SQL,
      );
    }
    if (filters.search?.trim()) {
      const term = `%${filters.search.trim()}%`;
      clauses.push(
        sql`(
          exists(select 1 from groups g where g.id = ${scheduleEntries.group_id} and g.name ilike ${term})
          or exists(select 1 from professors p where p.id = ${scheduleEntries.prof_id} and p.full_name ilike ${term})
          or exists(select 1 from student_assignments sa join students st on st.id = sa.student_id
                    where sa.group_id = ${scheduleEntries.group_id}
                      and (st.first_name ilike ${term} or st.last_name ilike ${term}))
        )` as SQL,
      );
    }

    const rows = await this.db.client.query.scheduleEntries.findMany({
      where: and(...clauses),
      columns: {
        id: true,
        group_id: true,
        time_slot_id: true,
        classroom_id: true,
        prof_id: true,
        subject: true,
        notes: true,
        effective_from: true,
        effective_until: true,
      },
      with: {
        group: {
          with: {
            /**
             * Only the id, because the professor is a waypoint and not a
             * payload: the field is read off it and lifted onto the group,
             * and nothing downstream looks at `group.professor` itself.
             *
             * Left unrestricted, Drizzle returns the whole professors row —
             * phone, e-mail, timestamps, archival flags — once per occurrence.
             * That single omission was 45% of a two-megabyte calendar
             * response, and it put staff contact details on the wire for a
             * screen that never shows them.
             */
            professor: {
              columns: { id: true },
              with: { field: { columns: { id: true, name: true, color: true } } },
            },
          },
          columns: { id: true, name: true, color: true },
        },
        timeSlot: { columns: { id: true, label: true, day_of_week: true, start_time: true, end_time: true } },
        classroom: { columns: { id: true, name: true, color: true, room_number: true } },
        professor: { columns: { id: true, full_name: true, color: true } },
      },
    });

    /**
     * Two shapes to reconcile, both hidden by the cast below.
     *
     * `timeSlot` vs `time_slot`: Drizzle names the relation as declared in
     * `relations.ts`, while `RuleRow` — and every line of the expansion — calls
     * it `time_slot`. Unreconciled, `rule.time_slot.day_of_week` threw on the
     * first rule and the endpoint answered 500, so the calendar and the
     * dashboard's session count were reading an error, not an empty schedule.
     *
     * `group.professor.field` vs `group.field`: the field belongs to the
     * professor in the schema but to the *session* in the reader's mind — it is
     * what a timetable calls the subject — so it is lifted onto the group,
     * which is where `RuleRow` and the calendar both look for it. The professor
     * waypoint is dropped once the field is off it: `Occurrence.group` declares
     * `{ id, name, color, field }` and nothing reads past that.
     */
    return rows.map((row) => {
      const group = row.group as { professor?: { field?: unknown } } | null;
      const { professor: _waypoint, ...groupFields } = group ?? {};
      return {
        ...row,
        time_slot: (row as { timeSlot?: unknown }).timeSlot,
        group: group ? { ...groupFields, field: group.professor?.field ?? null } : null,
      };
    }) as unknown as RuleRow[];
  }

  private async loadEntryExceptions(ruleIds: string[], fromDate: string, toDate: string): Promise<ScheduleEntryException[]> {
    const rows = await this.db.client.query.scheduleEntryExceptions.findMany({
      where: and(
        inArray(scheduleEntryExceptions.schedule_entry_id, ruleIds),
        gte(scheduleEntryExceptions.occurrence_date, new Date(fromDate + "T00:00:00Z")),
        lte(scheduleEntryExceptions.occurrence_date, new Date(toDate + "T23:59:59.999Z")),
      ),
    });
    return rows.map((r) => ({
      id: r.id,
      schedule_entry_id: r.schedule_entry_id,
      occurrence_date: dateString(r.occurrence_date),
      exception_type: r.exception_type as ScheduleEntryException["exception_type"],
      new_date: r.new_date ? dateString(r.new_date) : null,
      new_time_slot_id: r.new_time_slot_id,
      new_classroom_id: r.new_classroom_id,
      new_prof_id: r.new_prof_id,
      notes: r.notes,
      created_by: r.created_by,
      created_at: r.created_at.toISOString(),
      new_time_slot: null,
      new_classroom: null,
      new_professor: null,
    }));
  }

  private async loadStudentExceptions(studentId: string, ruleIds: string[], fromDate: string, toDate: string): Promise<StudentScheduleException[]> {
    const rows = await this.db.client.query.studentScheduleExceptions.findMany({
      where: and(
        eq(studentScheduleExceptions.student_id, studentId),
        inArray(studentScheduleExceptions.schedule_entry_id, ruleIds),
        gte(studentScheduleExceptions.exception_date, new Date(fromDate + "T00:00:00Z")),
        lte(studentScheduleExceptions.exception_date, new Date(toDate + "T23:59:59.999Z")),
      ),
    });
    return rows.map((r) => ({
      id: r.id,
      student_id: r.student_id,
      schedule_entry_id: r.schedule_entry_id,
      exception_type: r.exception_type as StudentScheduleException["exception_type"],
      exception_date: dateString(r.exception_date),
      notes: r.notes,
      created_at: r.created_at.toISOString(),
    }));
  }

  /** Professors / classrooms / time slots referenced by exception payloads. */
  private async loadReferenceEntities(exceptions: ScheduleEntryException[]): Promise<ReferenceEntities> {
    const profIds = [...new Set(exceptions.map((e) => e.new_prof_id).filter((x): x is string => !!x))];
    const roomIds = [...new Set(exceptions.map((e) => e.new_classroom_id).filter((x): x is string => !!x))];
    const slotIds = [...new Set(exceptions.map((e) => e.new_time_slot_id).filter((x): x is string => !!x))];

    const [profs, rooms, slots] = await Promise.all([
      profIds.length
        ? this.db.client.query.professors.findMany({ where: inArray(professors.id, profIds), columns: { id: true, full_name: true, color: true } })
        : Promise.resolve([]),
      roomIds.length
        ? this.db.client.query.classrooms.findMany({ where: inArray(classrooms.id, roomIds), columns: { id: true, name: true, color: true, room_number: true } })
        : Promise.resolve([]),
      slotIds.length
        ? this.db.client.query.timeSlots.findMany({ where: inArray(timeSlots.id, slotIds), columns: { id: true, day_of_week: true, start_time: true, end_time: true } })
        : Promise.resolve([]),
    ]);

    return {
      professors: new Map(profs.map((p) => [p.id, p])),
      classrooms: new Map(rooms.map((r) => [r.id, r])),
      timeSlots: new Map(slots.map((s) => [s.id, s])),
    };
  }

  private baseOccurrence(rule: RuleRow, date: string): Occurrence {
    return {
      occurrenceId: `${rule.id}::${date}`,
      scheduleEntryId: rule.id,
      date,
      start_time: rule.time_slot.start_time,
      end_time: rule.time_slot.end_time,
      status: "normal",
      movedFrom: null,
      subject: rule.subject,
      notes: rule.notes,
      group: rule.group,
      classroom: rule.classroom,
      professor: rule.professor,
      exception: null,
      studentException: null,
      color: rule.group.color,
    };
  }

  private applyEntryException(occurrence: Occurrence, ex: ScheduleEntryException, ref: ReferenceEntities): void {
    occurrence.exception = ex;
    occurrence.notes = ex.notes ?? occurrence.notes;
    switch (ex.exception_type) {
      case "cancelled":
        occurrence.status = "cancelled";
        break;
      case "moved": {
        occurrence.status = "moved";
        occurrence.movedFrom = { date: occurrence.date, start_time: occurrence.start_time };
        if (ex.new_date) occurrence.date = ex.new_date;
        const slot = ex.new_time_slot_id ? ref.timeSlots.get(ex.new_time_slot_id) : undefined;
        if (slot) {
          occurrence.start_time = slot.start_time;
          occurrence.end_time = slot.end_time;
        }
        if (ex.new_classroom_id) {
          const room = ref.classrooms.get(ex.new_classroom_id);
          if (room) occurrence.classroom = room;
        }
        if (ex.new_prof_id) {
          const prof = ref.professors.get(ex.new_prof_id);
          if (prof) occurrence.professor = prof;
        }
        break;
      }
      case "substitute_prof":
        occurrence.status = "substitute";
        if (ex.new_prof_id) {
          const prof = ref.professors.get(ex.new_prof_id);
          if (prof) occurrence.professor = prof;
        }
        break;
      case "room_change":
        occurrence.status = "room_change";
        if (ex.new_classroom_id) {
          const room = ref.classrooms.get(ex.new_classroom_id);
          if (room) occurrence.classroom = room;
        }
        break;
    }
  }

  /**
   * Student-level exceptions layer on top of the group result in the student's
   * own view. `cancelled` keeps the occurrence so the view can strike it
   * through (the rest of the group still meets), `substitute` re-tags without
   * touching the professor, `makeup` adds a synthetic occurrence.
   */
  private applyStudentException(occurrence: Occurrence, ex: StudentScheduleException): void {
    occurrence.studentException = ex;
    occurrence.notes = ex.notes ?? occurrence.notes;
    if (ex.exception_type === "cancelled") {
      occurrence.status = "student_cancelled";
    } else if (ex.exception_type === "substitute") {
      occurrence.status = "student_substitute";
    }
  }

  private makeupOccurrence(rule: RuleRow, ex: StudentScheduleException): Occurrence {
    return {
      ...this.baseOccurrence(rule, dateString(ex.exception_date)),
      status: "makeup",
      studentException: ex,
      occurrenceId: `${rule.id}::${dateString(ex.exception_date)}::makeup:${ex.id}`,
    };
  }
}

function compareByDateThenTime(a: Occurrence, b: Occurrence): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.start_time !== b.start_time) return a.start_time < b.start_time ? -1 : 1;
  return a.occurrenceId < b.occurrenceId ? -1 : 1;
}

function maxStr(date: Date | string, other: string): string {
  const d = dateString(date);
  return d > other ? d : other;
}

function minStr(date: Date | string | null, other: string): string {
  if (!date) return other;
  const d = dateString(date as Date | string);
  return d < other ? d : other;
}