import { Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, lte, or, sql, SQL } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import {
  classrooms,
  groups,
  professors,
  scheduleEntries,
  studentAssignments,
  studentScheduleExceptions,
  timeSlots,
} from "../../db/schema";
import { AuditService } from "../../audit/audit.service";
import { ConflictService } from "../conflicts/conflict.service";
import { Classroom, Conflict, ScheduleEntry, StudentScheduleException, TimeSlot } from "../types";
import {
  CreateScheduleEntryDto,
  UpdateScheduleEntryDto,
  PreviewTileDto,
  TileDto,
} from "../dto/schedule-entry.dto";

@Injectable()
export class ScheduleEntryService {
  constructor(
    private readonly db: DbService,
    private readonly conflict: ConflictService,
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
    return this.db.client.query.scheduleEntries.findMany({
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
    return entry as unknown as ScheduleEntry;
  }

  async create(dto: CreateScheduleEntryDto, userId?: string): Promise<{ entry: ScheduleEntry; conflicts: Conflict[] }> {
    const dateObj = new Date(dto.effective_from);
    const conflicts: Conflict[] = [];
    if (dto.prof_id) {
      conflicts.push(...(await this.conflict.checkProfessor(dto.prof_id, dto.time_slot_id, dto.effective_from, undefined)));
    }
    if (dto.classroom_id) {
      conflicts.push(...(await this.conflict.checkClassroom(dto.classroom_id, dto.time_slot_id, dto.effective_from, undefined)));
    }
    conflicts.push(...(await this.conflict.checkStudents(dto.group_id, dto.time_slot_id, dto.effective_from, undefined)));

    const [entry] = await this.db.client.insert(scheduleEntries).values({
      group_id: dto.group_id,
      time_slot_id: dto.time_slot_id,
      classroom_id: dto.classroom_id ?? null,
      prof_id: dto.prof_id,
      subject: dto.subject ?? null,
      notes: dto.notes ?? null,
      effective_from: dateObj,
      effective_until: dto.effective_until ? new Date(dto.effective_until) : null,
    }).returning();

    const full = await this.get(entry.id);
    const action = conflicts.length > 0 ? "schedule.entry.created_with_conflict" : "schedule.entry.created";
    await this.audit.record({
      action,
      entityType: "schedule_entry",
      entityId: entry.id,
      actorId: userId,
      newValues: { group_id: dto.group_id, time_slot_id: dto.time_slot_id, classroom_id: dto.classroom_id, prof_id: dto.prof_id, effective_from: dto.effective_from },
      meta: conflicts.length > 0 ? { conflicts } : undefined,
    });
    return { entry: full, conflicts };
  }

  async update(id: string, dto: UpdateScheduleEntryDto, userId?: string): Promise<{ entry: ScheduleEntry; conflicts: Conflict[] }> {
    const existing = await this.get(id);
    const data: Record<string, unknown> = {};
    if (dto.classroom_id !== undefined) data.classroom_id = dto.classroom_id;
    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.effective_until !== undefined) data.effective_until = dto.effective_until ? new Date(dto.effective_until) : null;

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
      ...e,
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
    return result as unknown as ScheduleEntry[];
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
    return result as unknown as ScheduleEntry[];
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
    return result as unknown as ScheduleEntry[];
  }

  async previewConflicts(dto: PreviewTileDto, excludeEntryId?: string): Promise<Conflict[]> {
    const results: Conflict[] = [];
    const date = dto.effective_from ?? new Date().toISOString().split("T")[0];
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
