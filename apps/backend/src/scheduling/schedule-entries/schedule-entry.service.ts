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
import { ConflictService } from "../conflicts/conflict.service";
import { WorkingHoursService } from "../working-hours/working-hours.service";
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
 * Both keys are emitted: `time_slot` is the contract, `timeSlot` is kept so
 * anything already reading the Drizzle-shaped payload keeps working.
 */
function withTimeSlot<T extends { timeSlot?: unknown }>(row: T): T & { time_slot: unknown } {
  return { ...row, time_slot: (row as { timeSlot?: unknown }).timeSlot ?? null };
}

const withTimeSlots = <T extends { timeSlot?: unknown }>(rows: T[]) => rows.map(withTimeSlot);

@Injectable()
export class ScheduleEntryService {
  constructor(
    private readonly db: DbService,
    private readonly conflict: ConflictService,
    private readonly workingHours: WorkingHoursService,
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
      with: {
        group: {
          with: {
            professor: {
              with: {
                field: { with: { level: true } },
              },
            },
          },
        },
        timeSlot: true,
        classroom: true,
        professor: { columns: { id: true, full_name: true, color: true } },
      },
    });
    return withTimeSlots(rows);
  }

  async get(id: string) {
    const entry = await this.db.client.query.scheduleEntries.findFirst({
      where: eq(scheduleEntries.id, id),
      with: {
        group: {
          with: {
            professor: {
              with: {
                field: { with: { level: true } },
              },
            },
          },
        },
        timeSlot: true,
        classroom: true,
        professor: { columns: { id: true, full_name: true, color: true } },
      },
    });
    if (!entry) throw new NotFoundException(`Schedule entry ${id} not found`);
    return withTimeSlot(entry) as unknown as ScheduleEntry;
  }

  async create(dto: CreateScheduleEntryDto, userId?: string): Promise<{ entry: ScheduleEntry; conflicts: Conflict[]; warnings: string[] }> {
    const dateObj = new Date(dto.effective_from);
    const conflicts: Conflict[] = [];
    const warnings: string[] = [];

    const slot = await this.db.client.query.timeSlots.findFirst({
      where: eq(timeSlots.id, dto.time_slot_id),
      columns: { id: true, day_of_week: true, start_time: true, end_time: true },
    });
    if (!slot) throw new NotFoundException(`Time slot ${dto.time_slot_id} not found`);

    conflicts.push(...(await this.conflict.checkRule({
      group_id: dto.group_id,
      time_slot_id: dto.time_slot_id,
      classroom_id: dto.classroom_id,
      prof_id: dto.prof_id,
      effective_from: dto.effective_from,
      effective_until: dto.effective_until ?? null,
    })));
    warnings.push(...(await this.workingHours.validateSlot(slot.day_of_week, slot.start_time, slot.end_time)));

    const [entry] = await this.db.client.insert(scheduleEntries).values({
      group_id: dto.group_id,
      time_slot_id: dto.time_slot_id,
      classroom_id: dto.classroom_id ?? null,
      prof_id: dto.prof_id,
      subject: dto.subject ?? null,
      notes: dto.notes ?? null,
      effective_from: dateObj,
      effective_until: dto.effective_until ? new Date(dto.effective_until + "T00:00:00Z") : null,
    }).returning();

    const full = await this.get(entry.id);
    const action = conflicts.length > 0 ? "schedule.entry.created_with_conflict" : "schedule.entry.created";
    await this.audit.record({
      action,
      entityType: "schedule_entry",
      entityId: entry.id,
      actorId: userId,
      newValues: { group_id: dto.group_id, time_slot_id: dto.time_slot_id, classroom_id: dto.classroom_id, prof_id: dto.prof_id, effective_from: dto.effective_from },
      meta: conflicts.length > 0 ? { conflicts } : warnings.length > 0 ? { warnings } : undefined,
    });
    return { entry: full, conflicts, warnings };
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
    newValues: { time_slot_id?: string; classroom_id?: string | null; prof_id?: string; subject?: string; notes?: string; effective_until?: string | null },
    userId?: string,
  ): Promise<{ entry: ScheduleEntry; conflicts: Conflict[]; warnings: string[]; split: boolean }> {
    const existing = await this.get(entryId);
    if (!existing.is_active) throw new BadRequestException("Cannot edit an archived rule");

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
      day_of_week: (existing as any).timeSlot.day_of_week,
      start_time: (existing as any).timeSlot.start_time,
      end_time: (existing as any).timeSlot.end_time,
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
      entityLabel: `${(existing as any).group.name} / ${(existing as any).timeSlot.label}`,
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
      entityLabel: `${(existing as any).group.name} / ${(existing as any).timeSlot.label}`,
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
        group: {
          with: {
            professor: {
              with: {
                field: { with: { level: true } },
              },
            },
          },
        },
        timeSlot: true,
        classroom: true,
        professor: { columns: { id: true, full_name: true, color: true } },
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
      ...withTimeSlot(e),
      studentExceptions: (e as any).studentExceptions as StudentScheduleException[],
    })) as unknown as ScheduleEntry[];
  }

  async getGroupSchedule(groupId: string, fromDate: string, toDate: string): Promise<ScheduleEntry[]> {
    const fromObj = new Date(fromDate);
    const toObj = new Date(toDate);
    const result = await this.db.client.query.scheduleEntries.findMany({
      where: and(
        eq(scheduleEntries.group_id, groupId),
        eq(scheduleEntries.is_active, true),
        lte(scheduleEntries.effective_from, toObj),
        or(
          sql`${scheduleEntries.effective_until} IS NULL`,
          gte(scheduleEntries.effective_until, fromObj),
        ),
      ),
      with: {
        group: {
          with: {
            professor: {
              with: {
                field: { with: { level: true } },
              },
            },
          },
        },
        timeSlot: true,
        classroom: true,
        professor: { columns: { id: true, full_name: true, color: true } },
      },
      orderBy: [asc(scheduleEntries.created_at)],
    });
    return withTimeSlots(result) as unknown as ScheduleEntry[];
  }

  async getProfessorSchedule(profId: string, fromDate: string, toDate: string): Promise<ScheduleEntry[]> {
    const fromObj = new Date(fromDate);
    const toObj = new Date(toDate);
    const result = await this.db.client.query.scheduleEntries.findMany({
      where: and(
        eq(scheduleEntries.prof_id, profId),
        eq(scheduleEntries.is_active, true),
        lte(scheduleEntries.effective_from, toObj),
        or(
          sql`${scheduleEntries.effective_until} IS NULL`,
          gte(scheduleEntries.effective_until, fromObj),
        ),
      ),
      with: {
        group: {
          with: {
            professor: {
              with: {
                field: { with: { level: true } },
              },
            },
          },
        },
        timeSlot: true,
        classroom: true,
        professor: { columns: { id: true, full_name: true, color: true } },
      },
      orderBy: [asc(scheduleEntries.created_at)],
    });
    return withTimeSlots(result) as unknown as ScheduleEntry[];
  }

  async getClassroomSchedule(classroomId: string, fromDate: string, toDate: string): Promise<ScheduleEntry[]> {
    const fromObj = new Date(fromDate);
    const toObj = new Date(toDate);
    const result = await this.db.client.query.scheduleEntries.findMany({
      where: and(
        eq(scheduleEntries.classroom_id, classroomId),
        eq(scheduleEntries.is_active, true),
        lte(scheduleEntries.effective_from, toObj),
        or(
          sql`${scheduleEntries.effective_until} IS NULL`,
          gte(scheduleEntries.effective_until, fromObj),
        ),
      ),
      with: {
        group: {
          with: {
            professor: {
              with: {
                field: { with: { level: true } },
              },
            },
          },
        },
        timeSlot: true,
        classroom: true,
        professor: { columns: { id: true, full_name: true, color: true } },
      },
      orderBy: [asc(scheduleEntries.created_at)],
    });
    return withTimeSlots(result) as unknown as ScheduleEntry[];
  }

  async previewConflicts(dto: PreviewTileDto, excludeEntryId?: string): Promise<Conflict[]> {
    const results: Conflict[] = [];
    const date = dto.effective_from ?? new Date().toISOString().split("T")[0];
    if (!dto.time_slot_id && dto.day_of_week !== undefined && dto.start_time && dto.end_time) {
      dto.time_slot_id = await this.resolveOrCreateTimeSlot(dto.day_of_week, dto.start_time, dto.end_time);
    }
    if (!dto.time_slot_id) return results;
    if (dto.prof_id) {
      results.push(...(await this.conflict.checkProfessor(dto.prof_id, dto.time_slot_id, date, excludeEntryId)));
    }
    if (dto.classroom_id) {
      results.push(...(await this.conflict.checkClassroom(dto.classroom_id, dto.time_slot_id, date, excludeEntryId)));
    }
    if (dto.exclude_group_id) {
      results.push(...(await this.conflict.checkStudents(dto.exclude_group_id, dto.time_slot_id, date, excludeEntryId)));
    }
    return results;
  }

  private async resolveOrCreateTimeSlot(dayOfWeek: number, startTime: string, endTime: string): Promise<string> {
    const existing = await this.db.client.query.timeSlots.findFirst({
      where: and(eq(timeSlots.day_of_week, dayOfWeek), eq(timeSlots.start_time, startTime), eq(timeSlots.end_time, endTime)),
      columns: { id: true },
    });
    if (existing) return existing.id;
    const dayNames = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
    const label = `${dayNames[dayOfWeek] ?? "Day"} ${startTime}–${endTime}`;
    const [slot] = await this.db.client.insert(timeSlots).values({
      label,
      day_of_week: dayOfWeek,
      start_time: startTime,
      end_time: endTime,
      sort_order: dayOfWeek * 100,
    }).returning();
    return slot.id;
  }

  private async runConflictChecks(dto: CreateScheduleEntryDto, excludeEntryId?: string): Promise<Conflict[]> {
    const ts = await this.db.client.query.timeSlots.findFirst({
      where: eq(timeSlots.id, dto.time_slot_id),
      columns: { id: true },
    });
    if (!ts) return [];
    const date = dto.effective_from;
    const results: Conflict[] = [];
    if (dto.prof_id) {
      results.push(...(await this.conflict.checkProfessor(dto.prof_id, dto.time_slot_id, date, excludeEntryId)));
    }
    if (dto.classroom_id) {
      results.push(...(await this.conflict.checkClassroom(dto.classroom_id, dto.time_slot_id, date, excludeEntryId)));
    }
    results.push(...(await this.conflict.checkStudents(dto.group_id, dto.time_slot_id, date, excludeEntryId)));
    return results;
  }
}
