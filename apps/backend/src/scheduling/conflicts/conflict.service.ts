import { Injectable } from "@nestjs/common";
import { and, eq, gt, gte, inArray, lt, lte, or, sql, SQL } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { classrooms, scheduleEntries, studentAssignments, students, timeSlots } from "../../db/schema";
import { Conflict } from "../types";

@Injectable()
export class ConflictService {
  constructor(private readonly db: DbService) {}

  async checkProfessor(profId: string, timeSlotId: string, date: string, excludeEntryId?: string): Promise<Conflict[]> {
    const ts = await this.db.client.query.timeSlots.findFirst({
      where: eq(timeSlots.id, timeSlotId),
      columns: { day_of_week: true, start_time: true, end_time: true, label: true },
    });
    if (!ts) return [];

    const dateObj = new Date(date);
    const rawClauses: (SQL | undefined)[] = [
      eq(scheduleEntries.prof_id, profId),
      eq(scheduleEntries.is_active, true),
      eq(timeSlots.day_of_week, ts.day_of_week),
      lt(timeSlots.start_time, ts.end_time),
      gt(timeSlots.end_time, ts.start_time),
      gte(scheduleEntries.effective_from, dateObj),
      or(sql`${scheduleEntries.effective_until} IS NULL`, gte(scheduleEntries.effective_until, dateObj)),
    ];
    if (excludeEntryId) rawClauses.push(sql`${scheduleEntries.id} != ${excludeEntryId}`);
    const clauses = rawClauses.filter((c): c is SQL => c !== undefined);
    const where = clauses.length > 0 ? (and(...clauses) as SQL) : (eq(scheduleEntries.id, scheduleEntries.id) as SQL);

    return this.buildConflicts("professor", profId, ts, date, where);
  }

  async checkClassroom(classroomId: string, timeSlotId: string, date: string, excludeEntryId?: string): Promise<Conflict[]> {
    const ts = await this.db.client.query.timeSlots.findFirst({
      where: eq(timeSlots.id, timeSlotId),
      columns: { day_of_week: true, start_time: true, end_time: true, label: true },
    });
    if (!ts) return [];

    const dateObj = new Date(date);
    const rawClauses: (SQL | undefined)[] = [
      eq(scheduleEntries.classroom_id, classroomId),
      eq(scheduleEntries.is_active, true),
      eq(timeSlots.day_of_week, ts.day_of_week),
      lt(timeSlots.start_time, ts.end_time),
      gt(timeSlots.end_time, ts.start_time),
      gte(scheduleEntries.effective_from, dateObj),
      or(sql`${scheduleEntries.effective_until} IS NULL`, gte(scheduleEntries.effective_until, dateObj)),
    ];
    if (excludeEntryId) rawClauses.push(sql`${scheduleEntries.id} != ${excludeEntryId}`);
    const clauses = rawClauses.filter((c): c is SQL => c !== undefined);
    const where = clauses.length > 0 ? (and(...clauses) as SQL) : (eq(scheduleEntries.id, scheduleEntries.id) as SQL);

    return this.buildConflicts("classroom", classroomId, ts, date, where);
  }

  async checkStudents(groupId: string, timeSlotId: string, date: string, excludeEntryId?: string): Promise<Conflict[]> {
    const ts = await this.db.client.query.timeSlots.findFirst({
      where: eq(timeSlots.id, timeSlotId),
      columns: { day_of_week: true, start_time: true, end_time: true, label: true },
    });
    if (!ts) return [];

    const enrolled = await this.db.client
      .select({ student_id: studentAssignments.student_id, group_id: studentAssignments.group_id })
      .from(studentAssignments)
      .where(eq(studentAssignments.group_id, groupId));

    const conflicts: Conflict[] = [];
    const seen = new Set<string>();

    for (const row of enrolled) {
      const otherGroupIds = enrolled.filter((e) => e.group_id !== groupId).map((e) => e.group_id);
      if (otherGroupIds.length === 0) continue;

      const dateObj = new Date(date);
      const rawClauses: (SQL | undefined)[] = [
        inArray(scheduleEntries.group_id, otherGroupIds),
        eq(scheduleEntries.is_active, true),
        eq(timeSlots.day_of_week, ts.day_of_week),
        lt(timeSlots.start_time, ts.end_time),
        gt(timeSlots.end_time, ts.start_time),
        gte(scheduleEntries.effective_from, dateObj),
        or(sql`${scheduleEntries.effective_until} IS NULL`, gte(scheduleEntries.effective_until, dateObj)) as SQL,
      ];
      if (excludeEntryId) rawClauses.push(sql`${scheduleEntries.id} != ${excludeEntryId}`);
      const clauses = rawClauses.filter((c): c is SQL => c !== undefined);

      const clashes = await this.db.client.query.scheduleEntries.findMany({
        where: and(...clauses),
        with: {
          group: { columns: { id: true, name: true } },
          timeSlot: { columns: { label: true } },
        },
      });

      for (const clash of clashes) {
        const student = await this.db.client.query.students.findFirst({
          where: eq(students.id, row.student_id),
          columns: { id: true, first_name: true, last_name: true },
        });
        if (!student) continue;
        const key = `${student.id}:${clash.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({
          type: "student",
          entityId: student.id,
          entityName: `${student.first_name} ${student.last_name}`,
          scheduleEntryId: clash.id,
          timeSlotLabel: `${ts.label} (${ts.start_time}–${ts.end_time})`,
          date,
        });
      }
    }
    return conflicts;
  }

  private async buildConflicts(
    type: Conflict["type"],
    entityId: string,
    ts: { day_of_week: number; start_time: string; end_time: string; label: string },
    date: string,
    where: SQL,
  ): Promise<Conflict[]> {
    const clashes = await this.db.client.query.scheduleEntries.findMany({
      where,
      with: { group: { columns: { id: true, name: true } } },
    });

    const entityName = await this.resolveEntityName(type, entityId);
    return clashes.map((clash) => ({
      type,
      entityId,
      entityName: entityName ?? entityId,
      scheduleEntryId: clash.id,
      timeSlotLabel: `${ts.label} (${ts.start_time}–${ts.end_time})`,
      date,
    }));
  }

  private async resolveEntityName(type: Conflict["type"], id: string): Promise<string | null> {
    if (type === "classroom") {
      const room = await this.db.client.query.classrooms.findFirst({
        where: eq(classrooms.id, id),
        columns: { name: true, building: true, room_number: true },
      });
      if (!room) return id;
      return room.building && room.room_number
        ? `${room.building} - ${room.room_number}`
        : room.name;
    }
    return id;
  }

  async scanAll(): Promise<Conflict[]> {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const activeEntries = await this.db.client.query.scheduleEntries.findMany({
      where: and(
        eq(scheduleEntries.is_active, true),
        lte(scheduleEntries.effective_from, today),
        or(sql`${scheduleEntries.effective_until} IS NULL`, gte(scheduleEntries.effective_until, today)),
      ),
      with: { timeSlot: { columns: { day_of_week: true, start_time: true, end_time: true, label: true } } },
    });

    const conflicts: Conflict[] = [];
    const seen = new Set<string>();

    for (const entry of activeEntries) {
      const ts = entry.timeSlot;
      if (!ts) continue;

      const profRaw: (SQL | undefined)[] = [
        eq(scheduleEntries.prof_id, entry.prof_id),
        eq(scheduleEntries.is_active, true),
        eq(scheduleEntries.id, entry.id),
        lt(timeSlots.start_time, ts.end_time),
        gt(timeSlots.end_time, ts.start_time),
        lte(scheduleEntries.effective_from, today),
        or(sql`${scheduleEntries.effective_until} IS NULL`, gte(scheduleEntries.effective_until, today)) as SQL,
      ];
      const profClashes = await this.db.client.query.scheduleEntries.findMany({
        where: and(...profRaw.filter((c): c is SQL => c !== undefined)),
        with: { group: { columns: { name: true } } },
      });
      for (const clash of profClashes) {
        const key = `prof:${entry.prof_id}:${ts.label}:${clash.group.name}`;
        if (!seen.has(key)) { seen.add(key); conflicts.push({ type: "professor", entityId: entry.prof_id, entityName: clash.group.name, scheduleEntryId: entry.id, timeSlotLabel: `${ts.label} (${ts.start_time}–${ts.end_time})`, date: todayStr }); }
      }

      if (entry.classroom_id) {
        const roomRaw: (SQL | undefined)[] = [
          eq(scheduleEntries.classroom_id, entry.classroom_id),
          eq(scheduleEntries.is_active, true),
          eq(scheduleEntries.id, entry.id),
          lt(timeSlots.start_time, ts.end_time),
          gt(timeSlots.end_time, ts.start_time),
          lte(scheduleEntries.effective_from, today),
          or(sql`${scheduleEntries.effective_until} IS NULL`, gte(scheduleEntries.effective_until, today)) as SQL,
        ];
        const roomClashes = await this.db.client.query.scheduleEntries.findMany({
          where: and(...roomRaw.filter((c): c is SQL => c !== undefined)),
          with: { group: { columns: { name: true } } },
        });
        for (const clash of roomClashes) {
          const key = `room:${entry.classroom_id}:${ts.label}:${clash.group.name}`;
          if (!seen.has(key)) { seen.add(key); conflicts.push({ type: "classroom", entityId: entry.classroom_id, entityName: clash.group.name, scheduleEntryId: entry.id, timeSlotLabel: `${ts.label} (${ts.start_time}–${ts.end_time})`, date: todayStr }); }
        }
      }
    }
    return conflicts;
  }
}
