import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { and, eq, gte, lt, gt, or, sql, SQL } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { ClassroomRepository } from "./classroom.repository";
import { AuditService } from "../../audit/audit.service";
import { CreateClassroomDto, UpdateClassroomDto } from "../dto/classroom.dto";
import { scheduleEntries, timeSlots, groups } from "../../db/schema";
import { schoolDayOfDate } from "../date.util";

/** One room's answer to "can I put a session here?" for a concrete window. */
export interface ClassroomAvailability {
  id: string;
  name: string;
  room_number: string | null;
  capacity: number | null;
  color: string | null;
  available: boolean;
  /** What is already in the room when it is not free. */
  conflicts: Array<{ scheduleEntryId: string; groupName: string; start_time: string; end_time: string }>;
}

@Injectable()
export class ClassroomService {
  constructor(
    private readonly repo: ClassroomRepository,
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(active?: boolean) {
    return this.repo.list(active);
  }

  /**
   * Every room, each marked free or taken for one concrete window.
   *
   * The UI needs this to answer "that room is busy — which one isn't?" without
   * asking the conflict service once per room, which is a round trip per room
   * on every keystroke of a time field. One query returns everything occupying
   * the window and the rooms are marked against it in memory.
   *
   * The overlap test is `existing.start < proposed.end AND existing.end >
   * proposed.start`, which is the same predicate `ConflictService` applies and
   * covers every case that counts as a clash: partial overlap at either end,
   * one window wholly inside the other, and identical windows. Sessions that
   * merely touch (one ends exactly when the next begins) are not a clash.
   */
  async availability(params: {
    date: string;
    start_time: string;
    end_time: string;
    excludeGroupId?: string;
    excludeEntryId?: string;
  }): Promise<ClassroomAvailability[]> {
    const rooms = await this.repo.list(true);
    const dayOfWeek = schoolDayOfDate(params.date);
    const dateObj = new Date(params.date + "T00:00:00Z");

    const bounds: SQL[] = [
      eq(scheduleEntries.is_active, true),
      eq(timeSlots.day_of_week, dayOfWeek),
      // Rule in force on the target date.
      sql`${scheduleEntries.effective_from} <= ${dateObj}`,
      or(sql`${scheduleEntries.effective_until} IS NULL`, gte(scheduleEntries.effective_until, dateObj)) as SQL,
      // The overlap predicate itself.
      lt(timeSlots.start_time, params.end_time),
      gt(timeSlots.end_time, params.start_time),
      sql`${scheduleEntries.classroom_id} IS NOT NULL`,
    ];
    if (params.excludeGroupId) bounds.push(sql`${scheduleEntries.group_id} != ${params.excludeGroupId}`);
    if (params.excludeEntryId) bounds.push(sql`${scheduleEntries.id} != ${params.excludeEntryId}`);

    const occupied = await this.db.client
      .select({
        entry_id: scheduleEntries.id,
        classroom_id: scheduleEntries.classroom_id,
        group_name: groups.name,
        start_time: timeSlots.start_time,
        end_time: timeSlots.end_time,
      })
      .from(scheduleEntries)
      .innerJoin(timeSlots, eq(timeSlots.id, scheduleEntries.time_slot_id))
      .innerJoin(groups, eq(groups.id, scheduleEntries.group_id))
      .where(and(...bounds));

    const byRoom = new Map<string, ClassroomAvailability["conflicts"]>();
    for (const row of occupied) {
      if (!row.classroom_id) continue;
      const list = byRoom.get(row.classroom_id) ?? [];
      list.push({
        scheduleEntryId: row.entry_id,
        groupName: row.group_name,
        start_time: String(row.start_time).slice(0, 5),
        end_time: String(row.end_time).slice(0, 5),
      });
      byRoom.set(row.classroom_id, list);
    }

    return rooms.map((room) => {
      const conflicts = byRoom.get(room.id) ?? [];
      return {
        id: room.id,
        name: room.name,
        room_number: room.room_number,
        capacity: room.capacity,
        color: room.color,
        available: conflicts.length === 0,
        conflicts,
      };
    });
  }

  async get(id: string) {
    const row = await this.repo.get(id);
    if (!row) throw new NotFoundException(`Classroom ${id} not found`);
    return row;
  }

  async create(dto: CreateClassroomDto, userId?: string) {
    if (dto.room_number) {
      const dup = await this.repo.findDuplicate(dto.room_number);
      if (dup) {
        throw new ConflictException(
          `Room "${dup.room_number ? " - " + dup.room_number : ""}" already exists`,
        );
      }
    }
    const room = await this.repo.create({
      name: dto.name,
      floor: dto.floor,
      room_number: dto.room_number,
      capacity: dto.capacity,
      equipment: dto.equipment ?? null,
      color: dto.color,
    });
    await this.audit.record({
      action: "schedule.classroom.created",
      entityType: "classroom",
      entityId: room.id,
      entityLabel: room.name,
      actorId: userId,
      newValues: { name: room.name, room_number: room.room_number, capacity: room.capacity },
    });
    return room;
  }

  async update(id: string, dto: UpdateClassroomDto, userId?: string) {
    const existing = await this.repo.get(id);
    if (!existing) throw new NotFoundException(`Classroom ${id} not found`);

    const roomNumber = dto.room_number ?? existing.room_number;
    if (roomNumber) {
      const dup = await this.repo.findDuplicate(roomNumber, id);
      if (dup) {
        throw new ConflictException(
          `Room "${dup.room_number ? " - " + dup.room_number : ""}" already exists`,
        );
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.floor !== undefined) data.floor = dto.floor;
    if (dto.room_number !== undefined) data.room_number = dto.room_number;
    if (dto.capacity !== undefined) data.capacity = dto.capacity;
    if (dto.equipment !== undefined) data.equipment = dto.equipment;
    // No `is_active` write: see UpdateClassroomDto — archiving is gone, so
    // there is no supported way to hide a room instead of deleting it.
    if (dto.color !== undefined) data.color = dto.color;

    const updated = await this.repo.update(id, data);

    await this.audit.record({
      action: "schedule.classroom.updated",
      entityType: "classroom",
      entityId: id,
      entityLabel: updated.name,
      actorId: userId,
      prevValues: { name: existing.name, is_active: existing.is_active },
      newValues: { name: updated.name, is_active: updated.is_active },
    });
    return updated;
  }

  /**
   * Permanently removes a classroom.
   *
   * This used to be an archive wearing a delete's name: it flipped
   * `is_active` to false and — without saying so — archived every schedule
   * entry that used the room, silently tearing sessions out of the timetable as
   * a side effect of what the operator read as "delete this room".
   *
   * Deleting now deletes, and a room still on the timetable is refused instead.
   * `schedule_entries.classroom_id` is ON DELETE RESTRICT, so the database
   * would refuse anyway; checking first is what turns an opaque foreign-key
   * error into a message naming the sessions in the way of it.
   */
  async remove(id: string, userId?: string) {
    const existing = await this.repo.get(id);
    if (!existing) throw new NotFoundException(`Classroom ${id} not found`);

    // Archived rules count: the row still references the room, so the delete
    // still fails, and the operator still needs to be told which ones.
    const referencing = await this.db.client
      .select({
        id: scheduleEntries.id,
        group_name: groups.name,
        is_active: scheduleEntries.is_active,
      })
      .from(scheduleEntries)
      .innerJoin(groups, eq(groups.id, scheduleEntries.group_id))
      .where(eq(scheduleEntries.classroom_id, id));

    if (referencing.length > 0) {
      const activeCount = referencing.filter((r) => r.is_active).length;
      const names = [...new Set(referencing.map((r) => r.group_name))].slice(0, 3);
      throw new ConflictException({
        message:
          `« ${existing.name} » est utilisée par ${referencing.length} séance(s)` +
          `${activeCount > 0 ? ` (dont ${activeCount} active(s))` : ""} : ` +
          `${names.join(", ")}${referencing.length > names.length ? "…" : ""}. ` +
          `Retirez la salle de ces séances avant de la supprimer.`,
        code: "CLASSROOM_IN_USE",
        entryCount: referencing.length,
        groups: names,
      });
    }

    await this.repo.remove(id);
    await this.audit.record({
      action: "schedule.classroom.deleted",
      entityType: "classroom",
      entityId: id,
      entityLabel: existing.name,
      actorId: userId,
      prevValues: {
        name: existing.name,
        room_number: existing.room_number,
        capacity: existing.capacity,
        color: existing.color,
      },
    });
    return { id, deleted: true };
  }
}
