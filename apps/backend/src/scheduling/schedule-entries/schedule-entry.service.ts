import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, lte, or, sql, SQL } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import {
  scheduleEntries,
  studentAssignments,
  studentScheduleExceptions,
  timeSlots,
} from "../../db/schema";
import { AuditService } from "../../audit/audit.service";
import { ConflictService, TimeSlotRef } from "../conflicts/conflict.service";
import { WorkingHoursService } from "../working-hours/working-hours.service";
import { TimeSlotService } from "../time-slots/time-slot.service";
import { Conflict, ScheduleEntry, StudentScheduleException } from "../types";
import {
  CreateScheduleEntryDto,
  UpdateScheduleEntryDto,
  PreviewTileDto,
} from "../dto/schedule-entry.dto";

/**
 * Renames the time-slot relation to the name the API contract uses.
 *
 * Drizzle returns a relation under the name it is declared with in
 * `relations.ts` — `timeSlot` — while `ScheduleEntry`, the type every consumer
 * on both sides of the wire is written against, declares `time_slot`. The two
 * disagreed, and the `as unknown as ScheduleEntry` casts at each return made
 * the compiler accept it, so nothing ever flagged the mismatch.
 *
 * The cost was silent and total: every reader of `entry.time_slot` got
 * `undefined`. A group's saved sessions were filtered out of the edit form as
 * "invalid", and the Schedule column of the group list was permanently blank —
 * so a schedule that had been stored correctly looked like it had never saved.
 *
 * The Drizzle-shaped `timeSlot` key is dropped rather than emitted alongside:
 * it was kept for a transition that is over — no reader on either side of the
 * wire references it — and shipping the slot twice was a seventh of the list
 * response.
 */
function withTimeSlot<T extends { timeSlot?: unknown }>(row: T): Omit<T, "timeSlot"> & { time_slot: unknown } {
  const { timeSlot, ...rest } = row;
  return { ...rest, time_slot: timeSlot ?? null };
}

/**
 * The relation graph `ScheduleEntry` actually declares.
 *
 * The previous shape asked for `group` with every column, its professor with
 * every column, that professor's field with every column and the field's whole
 * level — four nested rows per entry, of which the contract exposes a name and
 * a colour. On a 192-group timetable that was half of a 944 KB response, and
 * none of it reached a screen: the entries table renders the group name, the
 * professor name, the room and the slot.
 *
 * `field` is lifted off the professor by `withGroupField` below, because a
 * session's field is what a timetable calls its subject.
 */
const ENTRY_RELATIONS = {
  group: {
    columns: { id: true, name: true, color: true },
    with: {
      professor: {
        columns: { id: true },
        with: { field: { columns: { id: true, name: true, color: true } } },
      },
    },
  },
  timeSlot: true,
  classroom: true,
  professor: { columns: { id: true, full_name: true, color: true } },
} as const;

/** Lifts `group.professor.field` onto `group.field` and drops the waypoint. */
function withGroupField<T extends { group?: unknown }>(row: T): T {
  const group = row.group as { professor?: { field?: unknown } } | null | undefined;
  if (!group) return row;
  const { professor: _waypoint, ...groupFields } = group;
  return { ...row, group: { ...groupFields, field: group.professor?.field ?? null } };
}

/** The contract shape: `time_slot` named as declared, group flattened. */
const toEntry = <T extends { timeSlot?: unknown; group?: unknown }>(row: T) => withTimeSlot(withGroupField(row));
const toEntries = <T extends { timeSlot?: unknown; group?: unknown }>(rows: T[]) => rows.map(toEntry);

/**
 * Safety cap on the unfiltered entry list.
 *
 * The list is bounded by the timetable — roughly two rules per active group —
 * so a real school never approaches this. It exists so a runaway import or a
 * scripted caller cannot ask one request to materialise an unbounded result
 * set; it is set far above any timetable a school would actually run, so it
 * never silently truncates what an operator is looking at.
 */
const ENTRY_LIST_CAP = 5000;

@Injectable()
export class ScheduleEntryService {
  constructor(
    private readonly db: DbService,
    private readonly conflict: ConflictService,
    private readonly workingHours: WorkingHoursService,
    private readonly timeSlotService: TimeSlotService,
    private readonly audit: AuditService,
  ) {}

  async list(filters: {
    groupId?: string;
    profId?: string;
    classroomId?: string;
    timeSlotId?: string;
    date?: string;
    active?: boolean;
  }) {
    const clauses: SQL[] = [];
    if (filters.groupId) clauses.push(eq(scheduleEntries.group_id, filters.groupId));
    if (filters.profId) clauses.push(eq(scheduleEntries.prof_id, filters.profId));
    if (filters.classroomId) clauses.push(eq(scheduleEntries.classroom_id, filters.classroomId));
    if (filters.timeSlotId) clauses.push(eq(scheduleEntries.time_slot_id, filters.timeSlotId));
    if (filters.active !== undefined) clauses.push(eq(scheduleEntries.is_active, filters.active));
    if (filters.date) {
      const dateObj = new Date(filters.date);
      clauses.push(lte(scheduleEntries.effective_from, dateObj));
      clauses.push(or(sql`${scheduleEntries.effective_until} IS NULL`, gte(scheduleEntries.effective_until, dateObj)) as SQL);
    }

    const whereClause = clauses.length > 0 ? and(...clauses) : undefined;
    const rows = await this.db.client.query.scheduleEntries.findMany({
      where: whereClause,
      orderBy: [desc(scheduleEntries.effective_from), asc(scheduleEntries.created_at)],
      limit: ENTRY_LIST_CAP,
      with: ENTRY_RELATIONS,
    });
    return toEntries(rows);
  }

  async get(id: string) {
    const entry = await this.db.client.query.scheduleEntries.findFirst({
      where: eq(scheduleEntries.id, id),
      with: ENTRY_RELATIONS,
    });
    if (!entry) throw new NotFoundException(`Schedule entry ${id} not found`);
    return toEntry(entry) as unknown as ScheduleEntry;
  }

  /**
   * Several entries by id, in the order asked for.
   *
   * The weekly builder saves a whole week at once and hands back what it
   * created; resolving those one `get()` at a time was a round trip per session
   * on the save path, each carrying the same four-table join.
   */
  async getMany(ids: string[]): Promise<ScheduleEntry[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.client.query.scheduleEntries.findMany({
      where: inArray(scheduleEntries.id, ids),
      with: ENTRY_RELATIONS,
    });
    const byId = new Map(rows.map((row) => [row.id, toEntry(row)]));
    return ids.map((id) => byId.get(id)).filter(Boolean) as unknown as ScheduleEntry[];
  }

  /**
   * Creates one recurring session.
   *
   * Enforces the same two rules the weekly builder's save does — a window
   * outside opening hours and a double-booked room are both refused — because
   * they are properties of the timetable, not of the screen that edited it.
   * This path previously collected conflicts and warnings and then inserted
   * regardless, so the single-entry form could write exactly what the builder
   * refused.
   */
  async create(dto: CreateScheduleEntryDto, userId?: string): Promise<{ entry: ScheduleEntry; conflicts: Conflict[]; warnings: string[] }> {
    // Starts today unless a date is given, and runs open-ended. The form no
    // longer asks for either; see `CreateScheduleEntryDto.effective_from`.
    const effectiveFrom = dto.effective_from ?? new Date().toISOString().slice(0, 10);
    const dateObj = new Date(effectiveFrom + "T00:00:00Z");
    const conflicts: Conflict[] = [];
    const warnings: string[] = [];

    const slot = await this.resolveSlot(dto);

    // Opening hours first: an out-of-hours window is refused whatever the
    // rooms say, and there is no point resolving conflicts for it.
    const hours = await this.workingHours.checkContainment(slot.day_of_week, slot.start_time, slot.end_time);
    if (hours.status === "partial" || hours.status === "outside") {
      throw new ConflictException({
        message:
          `Cette séance est en dehors des horaires d'ouverture ` +
          `(horaires : ${this.workingHours.describeWindows(hours.windows)})`,
        code: "OUTSIDE_WORKING_HOURS",
      });
    }

    conflicts.push(...(await this.conflict.checkRule({
      group_id: dto.group_id,
      time_slot_id: slot.id,
      classroom_id: dto.classroom_id,
      prof_id: dto.prof_id,
      effective_from: effectiveFrom,
      effective_until: null,
    })));

    // A room cannot hold two classes at once — same rule, same code, as the
    // weekly builder's save path.
    const roomClashes = conflicts.filter((c) => c.type === "classroom");
    if (roomClashes.length > 0) {
      throw new ConflictException({
        message: "Cette salle est déjà occupée sur ce créneau",
        code: "CLASSROOM_UNAVAILABLE",
        conflicts: roomClashes,
      });
    }

    const [entry] = await this.db.client.insert(scheduleEntries).values({
      group_id: dto.group_id,
      time_slot_id: slot.id,
      classroom_id: dto.classroom_id ?? null,
      prof_id: dto.prof_id,
      subject: dto.subject ?? null,
      notes: dto.notes ?? null,
      effective_from: dateObj,
      // Open-ended: a series is ended deliberately, from the calendar.
      effective_until: null,
    }).returning();

    const full = await this.get(entry.id);
    const action = conflicts.length > 0 ? "schedule.entry.created_with_conflict" : "schedule.entry.created";
    await this.audit.record({
      action,
      entityType: "schedule_entry",
      entityId: entry.id,
      actorId: userId,
      newValues: { group_id: dto.group_id, time_slot_id: slot.id, classroom_id: dto.classroom_id, prof_id: dto.prof_id, effective_from: effectiveFrom },
      meta: conflicts.length > 0 ? { conflicts } : warnings.length > 0 ? { warnings } : undefined,
    });
    return { entry: full, conflicts, warnings };
  }

  /**
   * The stored slot for a create request, from times or from an explicit id.
   *
   * Explicit times win when both are given: they are what the operator typed,
   * and an id sent alongside them would be a stale echo of the previous window.
   */
  private async resolveSlot(dto: CreateScheduleEntryDto): Promise<{ id: string; day_of_week: number; start_time: string; end_time: string }> {
    if (dto.day_of_week !== undefined && dto.start_time && dto.end_time) {
      if (dto.end_time <= dto.start_time) {
        throw new BadRequestException("end_time must be after start_time");
      }
      const slot = await this.timeSlotService.findOrCreate(dto.day_of_week, dto.start_time, dto.end_time);
      return {
        id: slot.id,
        day_of_week: dto.day_of_week,
        start_time: dto.start_time.slice(0, 5),
        end_time: dto.end_time.slice(0, 5),
      };
    }

    if (!dto.time_slot_id) {
      throw new BadRequestException("Provide day_of_week with start_time and end_time, or a time_slot_id");
    }
    const stored = await this.db.client.query.timeSlots.findFirst({
      where: eq(timeSlots.id, dto.time_slot_id),
      columns: { id: true, day_of_week: true, start_time: true, end_time: true },
    });
    if (!stored) throw new NotFoundException(`Time slot ${dto.time_slot_id} not found`);
    return {
      id: stored.id,
      day_of_week: stored.day_of_week,
      start_time: String(stored.start_time).slice(0, 5),
      end_time: String(stored.end_time).slice(0, 5),
    };
  }

  /**
   * "This and following" edit. When `fromDate` equals the rule's own start date
   * the rule updates in place; otherwise the rule is truncated at `fromDate - 1`
   * and a clone carrying the new values continues from `fromDate`.
   *
   * Layer 1 conflicts block the operation (409) — this is the series-edit path
   * the calendar uses after an interactive preview, so a clash here means the
   * admin deliberately overrode the preview.
   */
  async splitAndUpdate(
    entryId: string,
    fromDate: string,
    newValues: { day_of_week?: number; start_time?: string; end_time?: string; time_slot_id?: string; classroom_id?: string | null; prof_id?: string; subject?: string; notes?: string; effective_until?: string | null },
    userId?: string,
  ): Promise<{ entry: ScheduleEntry; conflicts: Conflict[]; warnings: string[]; split: boolean }> {
    const existing = await this.get(entryId);
    if (!existing.is_active) throw new BadRequestException("Cannot edit an archived rule");

    // Times may be given directly instead of a slot id. The weekday defaults to
    // the rule's current one, so changing only the hours keeps the same day.
    if (newValues.start_time && newValues.end_time) {
      if (newValues.end_time <= newValues.start_time) {
        throw new BadRequestException("end_time must be after start_time");
      }
      const day = newValues.day_of_week ?? (existing as any).time_slot.day_of_week;
      const hours = await this.workingHours.checkContainment(day, newValues.start_time, newValues.end_time);
      if (hours.status === "partial" || hours.status === "outside") {
        throw new ConflictException({
          message:
            `Ce nouvel horaire est en dehors des horaires d'ouverture ` +
            `(horaires : ${this.workingHours.describeWindows(hours.windows)})`,
          code: "OUTSIDE_WORKING_HOURS",
        });
      }
      const slot = await this.timeSlotService.findOrCreate(day, newValues.start_time, newValues.end_time);
      newValues = { ...newValues, time_slot_id: slot.id };
    }

    const existingFrom = this.isoDate(existing.effective_from);
    const existingUntil = existing.effective_until ? this.isoDate(existing.effective_until) : null;

    if (fromDate === existingFrom) {
      // No split — update the rule in place.
      const data: Record<string, unknown> = {};
      if (newValues.time_slot_id !== undefined) data.time_slot_id = newValues.time_slot_id;
      if (newValues.classroom_id !== undefined) data.classroom_id = newValues.classroom_id;
      if (newValues.prof_id !== undefined) data.prof_id = newValues.prof_id;
      if (newValues.subject !== undefined) data.subject = newValues.subject;
      if (newValues.notes !== undefined) data.notes = newValues.notes;
      if (newValues.effective_until !== undefined) data.effective_until = newValues.effective_until ? new Date(newValues.effective_until + "T00:00:00Z") : null;

      const result = await this.prepareSplitValues(
        {
          ...existing,
          time_slot_id: newValues.time_slot_id ?? existing.time_slot_id,
          classroom_id: newValues.classroom_id !== undefined ? newValues.classroom_id : existing.classroom_id,
          prof_id: newValues.prof_id ?? existing.prof_id,
          subject: newValues.subject !== undefined ? newValues.subject : existing.subject,
          notes: newValues.notes !== undefined ? newValues.notes : existing.notes,
          effective_until: newValues.effective_until !== undefined ? (newValues.effective_until ? new Date(newValues.effective_until + "T00:00:00Z") : null) : existing.effective_until,
        } as unknown as ScheduleEntry,
        fromDate,
        existingUntil,
        entryId,
        userId,
        false,
      );

      const [updated] = await this.db.client.update(scheduleEntries).set(data).where(eq(scheduleEntries.id, entryId)).returning();
      const full = await this.get(updated.id);
      await this.audit.record({
        action: "schedule.entry.split",
        entityType: "schedule_entry",
        entityId: entryId,
        actorId: userId,
        prevValues: { time_slot_id: existing.time_slot_id, classroom_id: existing.classroom_id, prof_id: existing.prof_id, subject: existing.subject, notes: existing.notes, effective_until: existingUntil },
        newValues: data,
      });
      return { entry: full, conflicts: [], warnings: result.warnings, split: false };
    }

    if (fromDate < existingFrom) {
      throw new BadRequestException(`from_date ${fromDate} is before the rule's effective_from ${existingFrom}`);
    }

    return this.prepareSplitValues(existing, fromDate, existingUntil, entryId, userId, true, newValues);
  }

  /** "Cancel this and following": truncate the rule at `fromDate - 1`. */
  async endSeries(entryId: string, fromDate: string, userId?: string): Promise<{ ended: boolean; effective_until: string | null }> {
    const existing = await this.get(entryId);
    const existingFrom = this.isoDate(existing.effective_from);
    if (fromDate <= existingFrom) {
      // The whole series sits at or after `fromDate`: hard archive is clearer than an empty shell.
      await this.archive(entryId, userId);
      return { ended: true, effective_until: null };
    }
    const until = new Date(fromDate + "T00:00:00Z");
    until.setUTCDate(until.getUTCDate() - 1);
    await this.db.client.update(scheduleEntries).set({ effective_until: until }).where(eq(scheduleEntries.id, entryId));
    await this.audit.record({
      action: "schedule.entry.series_ended",
      entityType: "schedule_entry",
      entityId: entryId,
      actorId: userId,
      prevValues: { effective_until: existing.effective_until ? this.isoDate(existing.effective_until) : null },
      newValues: { effective_until: until.toISOString().slice(0, 10) },
    });
    return { ended: true, effective_until: until.toISOString().slice(0, 10) };
  }

  private isoDate(value: Date | string): string {
    return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).split("T")[0];
  }

  private async prepareSplitValues(
    existing: ScheduleEntry,
    fromDate: string,
    existingUntil: string | null,
    entryId: string,
    userId: string | undefined,
    doSplit: boolean,
    newValues?: { time_slot_id?: string; classroom_id?: string | null; prof_id?: string; subject?: string; notes?: string; effective_until?: string | null },
  ): Promise<{ entry: ScheduleEntry; conflicts: Conflict[]; warnings: string[]; split: boolean }> {
    const timeSlotId = newValues?.time_slot_id ?? existing.time_slot_id;
    const classroomId = newValues?.classroom_id !== undefined ? newValues.classroom_id : existing.classroom_id;
    const profId = newValues?.prof_id ?? existing.prof_id;
    const subject = newValues?.subject !== undefined ? newValues.subject : existing.subject;
    const notes = newValues?.notes !== undefined ? newValues.notes : existing.notes;
    const until = newValues?.effective_until !== undefined ? newValues.effective_until : existingUntil;

    const slot = await this.db.client.query.timeSlots.findFirst({
      where: eq(timeSlots.id, timeSlotId),
      columns: { id: true, day_of_week: true, start_time: true, end_time: true },
    });
    if (!slot) throw new NotFoundException(`Time slot ${timeSlotId} not found`);

    const proposed = {
      group_id: existing.group_id,
      time_slot_id: timeSlotId,
      classroom_id: classroomId,
      prof_id: profId,
      effective_from: fromDate,
      effective_until: until,
      excludeEntryId: entryId,
    };
    const conflicts = await this.conflict.checkRule(proposed);
    if (conflicts.length > 0) {
      const err = new ConflictException("This change clashes with existing sessions");
      (err as any).conflicts = conflicts;
      throw err;
    }
    const warnings = await this.workingHours.validateSlot(slot.day_of_week, slot.start_time, slot.end_time);

    if (!doSplit) {
      return { entry: existing, conflicts: [], warnings, split: false };
    }

    const untilDate = new Date(fromDate + "T00:00:00Z");
    untilDate.setUTCDate(untilDate.getUTCDate() - 1);

    const row = await this.db.client.transaction(async (tx) => {
      await tx.update(scheduleEntries).set({ effective_until: untilDate }).where(eq(scheduleEntries.id, entryId));
      const [inserted] = await tx.insert(scheduleEntries).values({
        group_id: existing.group_id,
        time_slot_id: timeSlotId,
        classroom_id: classroomId,
        prof_id: profId,
        subject: subject ?? null,
        notes: notes ?? null,
        effective_from: new Date(fromDate + "T00:00:00Z"),
        effective_until: until ? new Date(until + "T00:00:00Z") : null,
      }).returning();
      if (!inserted) {
        throw new ConflictException("A rule for this group/slot already starts on the same date — adjust the range first");
      }
      return inserted;
    });
    const created: ScheduleEntry = await this.get(row.id);

    await this.audit.record({
      action: "schedule.entry.split",
      entityType: "schedule_entry",
      entityId: created.id,
      actorId: userId,
      prevValues: {
        split_from: this.isoDate(existing.effective_from),
        split_until: untilDate.toISOString().slice(0, 10),
      },
      newValues: {
        time_slot_id: timeSlotId,
        classroom_id: classroomId,
        prof_id: profId,
        subject,
        notes,
        effective_from: fromDate,
        effective_until: until,
      },
      meta: warnings.length > 0 ? { warnings } : undefined,
    });
    return { entry: created, conflicts: [], warnings, split: true };
  }

  async update(id: string, dto: UpdateScheduleEntryDto, userId?: string): Promise<{ entry: ScheduleEntry; conflicts: Conflict[] }> {
    const existing = await this.get(id);
    const data: Record<string, unknown> = {};
    if (dto.classroom_id !== undefined) data.classroom_id = dto.classroom_id;
    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.effective_until !== undefined) data.effective_until = dto.effective_until ? new Date(dto.effective_until + "T00:00:00Z") : null;

    const previewDto: PreviewTileDto = {
      day_of_week: (existing as any).time_slot.day_of_week,
      start_time: (existing as any).time_slot.start_time,
      end_time: (existing as any).time_slot.end_time,
      classroom_id: dto.classroom_id ?? (existing as any).classroom_id,
      prof_id: (existing as any).prof_id,
      exclude_group_id: (existing as any).group_id,
      time_slot_id: (existing as any).time_slot_id,
      effective_from: (existing as any).effective_from,
    };
    const conflicts = await this.previewConflicts(previewDto, id);

    const [updated] = await this.db.client.update(scheduleEntries).set(data).where(eq(scheduleEntries.id, id)).returning();
    const full = await this.get(updated.id);
    await this.audit.record({
      action: "schedule.entry.updated",
      entityType: "schedule_entry",
      entityId: id,
      actorId: userId,
      prevValues: { subject: (existing as any).subject, notes: (existing as any).notes, classroom_id: (existing as any).classroom_id, effective_until: (existing as any).effective_until },
      newValues: { subject: (full as any).subject, notes: (full as any).notes, classroom_id: (full as any).classroom_id, effective_until: (full as any).effective_until },
      meta: conflicts.length > 0 ? { conflicts } : undefined,
    });
    return { entry: full, conflicts };
  }

  async archive(id: string, userId?: string) {
    const existing = await this.get(id);
    const today = new Date();
    const [updated] = await this.db.client
      .update(scheduleEntries)
      .set({ is_active: false, effective_until: today })
      .where(eq(scheduleEntries.id, id))
      .returning();
    await this.audit.record({
      action: "schedule.entry.archived",
      entityType: "schedule_entry",
      entityId: id,
      entityLabel: `${(existing as any).group.name} / ${(existing as any).time_slot.label}`,
      actorId: userId,
      prevValues: { is_active: true },
      newValues: { is_active: false, effective_until: today },
    });
    return updated;
  }

  async remove(id: string, userId?: string) {
    const existing = await this.get(id);
    const [deleted] = await this.db.client.delete(scheduleEntries).where(eq(scheduleEntries.id, id)).returning();
    await this.audit.record({
      action: "schedule.entry.deleted",
      entityType: "schedule_entry",
      entityId: id,
      entityLabel: `${(existing as any).group.name} / ${(existing as any).time_slot.label}`,
      actorId: userId,
      prevValues: { group_id: (existing as any).group_id, time_slot_id: (existing as any).time_slot_id },
    });
    return deleted;
  }

  async getStudentSchedule(studentId: string, fromDate: string, toDate: string): Promise<ScheduleEntry[]> {
    const groupRows = await this.db.client
      .select({ group_id: studentAssignments.group_id })
      .from(studentAssignments)
      .where(eq(studentAssignments.student_id, studentId));
    const groupIds = groupRows.map((r) => r.group_id);
    if (groupIds.length === 0) return [];

    const fromObj = new Date(fromDate);
    const toObj = new Date(toDate);
    const entries = await this.db.client.query.scheduleEntries.findMany({
      where: and(
        inArray(scheduleEntries.group_id, groupIds),
        eq(scheduleEntries.is_active, true),
        lte(scheduleEntries.effective_from, toObj),
        or(sql`${scheduleEntries.effective_until} IS NULL`, gte(scheduleEntries.effective_until, fromObj)) as SQL,
      ),
      with: {
        ...ENTRY_RELATIONS,
        studentExceptions: {
          where: and(
            eq(studentScheduleExceptions.student_id, studentId),
            gte(studentScheduleExceptions.exception_date, fromObj),
            lte(studentScheduleExceptions.exception_date, toObj),
          ),
        },
      },
      orderBy: [asc(scheduleEntries.created_at)],
    });

    return entries.map((e) => ({
      ...toEntry(e),
      studentExceptions: (e as any).studentExceptions as StudentScheduleException[],
    })) as unknown as ScheduleEntry[];
  }

  getGroupSchedule(groupId: string, fromDate: string, toDate: string): Promise<ScheduleEntry[]> {
    return this.scheduleFor(eq(scheduleEntries.group_id, groupId), fromDate, toDate);
  }

  getProfessorSchedule(profId: string, fromDate: string, toDate: string): Promise<ScheduleEntry[]> {
    return this.scheduleFor(eq(scheduleEntries.prof_id, profId), fromDate, toDate);
  }

  getClassroomSchedule(classroomId: string, fromDate: string, toDate: string): Promise<ScheduleEntry[]> {
    return this.scheduleFor(eq(scheduleEntries.classroom_id, classroomId), fromDate, toDate);
  }

  /**
   * Live rules for one owner over a date window.
   *
   * The group, professor and classroom variants differ only in which column
   * they pin, so they share one body — three copies of the same query is three
   * places for the relation graph to drift out of step with the contract.
   */
  private async scheduleFor(owner: SQL, fromDate: string, toDate: string): Promise<ScheduleEntry[]> {
    const fromObj = new Date(fromDate);
    const toObj = new Date(toDate);
    const result = await this.db.client.query.scheduleEntries.findMany({
      where: and(
        owner,
        eq(scheduleEntries.is_active, true),
        lte(scheduleEntries.effective_from, toObj),
        or(
          sql`${scheduleEntries.effective_until} IS NULL`,
          gte(scheduleEntries.effective_until, fromObj),
        ),
      ),
      with: ENTRY_RELATIONS,
      orderBy: [asc(scheduleEntries.created_at)],
    });
    return toEntries(result) as unknown as ScheduleEntry[];
  }

  /**
   * "Would this tile clash?" — asked live while the weekly builder is edited.
   *
   * A read, and now only a read: it used to resolve the proposed window to a
   * `time_slots` row and *create* one when the window was new, so previewing a
   * timetable wrote to the database and left a row behind for every time an
   * admin tried and discarded. The conflict service answers a bare window
   * directly, so nothing is persisted until the schedule is actually saved.
   *
   * The three checks are independent, so they go out together rather than one
   * after another.
   */
  async previewConflicts(dto: PreviewTileDto, excludeEntryId?: string): Promise<Conflict[]> {
    const date = dto.effective_from ?? new Date().toISOString().split("T")[0];
    const slot = await this.describeSlot(dto);
    if (!slot) return [];

    const [professorClashes, classroomClashes, studentClashes] = await Promise.all([
      dto.prof_id ? this.conflict.checkProfessor(dto.prof_id, slot, date, excludeEntryId, dto.exclude_group_id) : Promise.resolve([]),
      dto.classroom_id ? this.conflict.checkClassroom(dto.classroom_id, slot, date, excludeEntryId, dto.exclude_group_id) : Promise.resolve([]),
      dto.exclude_group_id ? this.conflict.checkStudents(dto.exclude_group_id, slot, date, excludeEntryId) : Promise.resolve([]),
    ]);
    return [...professorClashes, ...classroomClashes, ...studentClashes];
  }

  /**
   * The proposed slot as a reference the conflict checks can use — the stored
   * row when the tile names one, otherwise the bare window it describes.
   */
  private async describeSlot(dto: PreviewTileDto): Promise<TimeSlotRef | null> {
    if (dto.time_slot_id) {
      const stored = await this.db.client.query.timeSlots.findFirst({
        where: eq(timeSlots.id, dto.time_slot_id),
        columns: { id: true, label: true, day_of_week: true, start_time: true, end_time: true },
      });
      if (stored) return stored as TimeSlotRef;
    }
    if (dto.day_of_week === undefined || !dto.start_time || !dto.end_time) return null;

    const existing = await this.db.client.query.timeSlots.findFirst({
      where: and(
        eq(timeSlots.day_of_week, dto.day_of_week),
        eq(timeSlots.start_time, dto.start_time),
        eq(timeSlots.end_time, dto.end_time),
      ),
      columns: { id: true, label: true, day_of_week: true, start_time: true, end_time: true },
    });
    if (existing) return existing as TimeSlotRef;

    // Never saved: describe it in place. The empty id is only ever compared
    // against `excludeEntryId`, which no unsaved window can match.
    const dayNames = ["Sam", "Dim", "Lun", "Mar", "Mer", "Jeu", "Ven"];
    return {
      id: "",
      label: `${dayNames[dto.day_of_week] ?? "Day"} ${dto.start_time}–${dto.end_time}`,
      day_of_week: dto.day_of_week,
      start_time: dto.start_time,
      end_time: dto.end_time,
    };
  }
}
