import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { timeSlots } from "../../db/schema";
import { AuditService } from "../../audit/audit.service";
import { CreateTimeSlotDto, UpdateTimeSlotDto, ReorderTimeSlotsDto } from "../dto/time-slot.dto";

@Injectable()
export class TimeSlotService {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  async list(dayOfWeek?: number) {
    const where = dayOfWeek !== undefined ? eq(timeSlots.day_of_week, dayOfWeek) : undefined;
    return this.db.client.query.timeSlots.findMany({
      where,
      orderBy: [asc(timeSlots.sort_order), asc(timeSlots.start_time)],
    });
  }

  async get(id: string) {
    const row = await this.db.client.query.timeSlots.findFirst({
      where: eq(timeSlots.id, id),
    });
    if (!row) throw new NotFoundException(`Time slot ${id} not found`);
    return row;
  }

  /**
   * The stored row for a (day, start, end) window, creating it if new.
   *
   * `time_slots` is no longer a catalogue an administrator curates — sessions
   * are given their times directly and the row is just the normalised tuple
   * those times resolve to, shared by every session that meets then. Both
   * creation paths (the weekly builder's sync and the single-entry create) go
   * through here so a window means the same row whichever screen made it.
   *
   * Only ever called from a save. The live conflict preview deliberately does
   * not resolve through this: previewing a timetable must not write rows for
   * every window an operator tries and discards.
   */
  async findOrCreate(dayOfWeek: number, startTime: string, endTime: string): Promise<{ id: string; label: string }> {
    const start = startTime.slice(0, 5);
    const end = endTime.slice(0, 5);

    const existing = await this.db.client.query.timeSlots.findFirst({
      where: and(
        eq(timeSlots.day_of_week, dayOfWeek),
        eq(timeSlots.start_time, start),
        eq(timeSlots.end_time, end),
      ),
      columns: { id: true, label: true },
    });
    if (existing) return existing;

    const dayNames = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
    const label = `${dayNames[dayOfWeek] ?? "Day"} ${start}–${end}`;
    const [slot] = await this.db.client
      .insert(timeSlots)
      .values({ label, day_of_week: dayOfWeek, start_time: start, end_time: end, sort_order: dayOfWeek * 100 })
      .returning({ id: timeSlots.id, label: timeSlots.label });
    return slot;
  }

  async create(dto: CreateTimeSlotDto, userId?: string) {
    await this.assertUnique(dto.day_of_week, dto.start_time, dto.end_time);
    const [slot] = await this.db.client.insert(timeSlots).values({
      label: dto.label,
      day_of_week: dto.day_of_week,
      start_time: dto.start_time,
      end_time: dto.end_time,
      sort_order: dto.sort_order ?? 0,
    }).returning();
    await this.audit.record({
      action: "schedule.time_slot.created",
      entityType: "time_slot",
      entityId: slot.id,
      entityLabel: slot.label,
      actorId: userId,
      newValues: { label: slot.label, day_of_week: slot.day_of_week, start_time: slot.start_time, end_time: slot.end_time },
    });
    return slot;
  }

  async update(id: string, dto: UpdateTimeSlotDto, userId?: string) {
    const existing = await this.get(id);
    const day = dto.day_of_week ?? existing.day_of_week;
    const start = dto.start_time ?? existing.start_time;
    const end = dto.end_time ?? existing.end_time;
    if (dto.day_of_week !== undefined || dto.start_time !== undefined || dto.end_time !== undefined) {
      await this.assertUnique(day, start, end, id);
    }
    const data: Record<string, unknown> = {};
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.day_of_week !== undefined) data.day_of_week = dto.day_of_week;
    if (dto.start_time !== undefined) data.start_time = dto.start_time;
    if (dto.end_time !== undefined) data.end_time = dto.end_time;
    if (dto.sort_order !== undefined) data.sort_order = dto.sort_order;
    const [updated] = await this.db.client.update(timeSlots).set(data).where(eq(timeSlots.id, id)).returning();
    await this.audit.record({
      action: "schedule.time_slot.updated",
      entityType: "time_slot",
      entityId: id,
      entityLabel: updated.label,
      actorId: userId,
      prevValues: { label: existing.label, day_of_week: existing.day_of_week, start_time: existing.start_time, end_time: existing.end_time },
      newValues: { label: updated.label, day_of_week: updated.day_of_week, start_time: updated.start_time, end_time: updated.end_time },
    });
    return updated;
  }

  async reorder(dto: ReorderTimeSlotsDto, userId?: string) {
    await this.db.client.transaction(async (tx) => {
      for (let i = 0; i < dto.ids.length; i++) {
        await tx.update(timeSlots).set({ sort_order: i }).where(eq(timeSlots.id, dto.ids[i]));
      }
    });
    await this.audit.record({
      action: "schedule.time_slot.reordered",
      entityType: "time_slot",
      actorId: userId,
      newValues: { ids: dto.ids },
    });
    return this.list();
  }

  async remove(id: string, userId?: string) {
    const existing = await this.get(id);
    const [deleted] = await this.db.client.delete(timeSlots).where(eq(timeSlots.id, id)).returning();
    await this.audit.record({
      action: "schedule.time_slot.deleted",
      entityType: "time_slot",
      entityId: id,
      entityLabel: existing.label,
      actorId: userId,
      prevValues: { label: existing.label, day_of_week: existing.day_of_week },
    });
    return deleted;
  }

  private async assertUnique(dayOfWeek: number, start: string, end: string, excludeId?: string) {
    const candidates = await this.db.client.query.timeSlots.findMany({
      where: and(eq(timeSlots.day_of_week, dayOfWeek), excludeId ? sql`${timeSlots.id} != ${excludeId}` : undefined),
    });
    const clash = candidates.find(
      (s) => s.start_time === start && s.end_time === end,
    );
    if (clash) {
      throw new ConflictException(
        `Time slot "${clash.label}" (${clash.start_time}–${clash.end_time}) already exists on day ${clash.day_of_week}`,
      );
    }
  }
}
