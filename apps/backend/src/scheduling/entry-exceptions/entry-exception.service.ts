import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, gte, lte, SQL } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { scheduleEntries, scheduleEntryExceptions, timeSlots } from "../../db/schema";
import { AuditService } from "../../audit/audit.service";
import { ConflictService } from "../conflicts/conflict.service";
import { CreateEntryExceptionDto, ListEntryExceptionsDto } from "../dto/entry-exception.dto";
import type { Conflict, ScheduleEntryException } from "../types";

/**
 * Whole-class, single-date overrides on a recurring rule: cancellation (a
 * one-off holiday), a move to another day/time/room, a substitute professor, or
 * a room change for one session only. Never touches the rule itself — the rule
 * keeps recurring; only the affected occurrence is overridden.
 */
@Injectable()
export class EntryExceptionService {
  constructor(
    private readonly db: DbService,
    private readonly conflict: ConflictService,
    private readonly audit: AuditService,
  ) {}

  async create(scheduleEntryId: string, dto: CreateEntryExceptionDto, userId?: string): Promise<ScheduleEntryException> {
    const rule = await this.db.client.query.scheduleEntries.findFirst({
      where: eq(scheduleEntries.id, scheduleEntryId),
      with: { group: { columns: { name: true } }, timeSlot: { columns: { label: true, start_time: true, end_time: true } } },
    });
    if (!rule) throw new NotFoundException(`Schedule entry ${scheduleEntryId} not found`);
    if (!rule.is_active) throw new BadRequestException("Cannot add an exception to an archived rule");

    this.validateFields(dto);
    await this.assertOccurrenceExists(scheduleEntryId, dto.occurrence_date);

    // Layer 2: the target professor/classroom must be free on the target date.
    if (dto.exception_type !== "cancelled") {
      const targetDate = dto.exception_type === "moved" && dto.new_date ? dto.new_date : dto.occurrence_date;
      const { start, end } = dto.new_time_slot_id
        ? await this.timeBounds(dto.new_time_slot_id)
        : { start: rule.timeSlot.start_time, end: rule.timeSlot.end_time };

      const conflicts: Conflict[] = [];
      if (dto.new_prof_id) {
        conflicts.push(...(await this.conflict.checkOccurrencesOnDate({ profId: dto.new_prof_id }, targetDate, start, end, scheduleEntryId)));
      }
      if (dto.new_classroom_id) {
        conflicts.push(...(await this.conflict.checkOccurrencesOnDate({ classroomId: dto.new_classroom_id }, targetDate, start, end, scheduleEntryId)));
      }
      if (conflicts.length > 0) {
        const err = new ConflictException("This change clashes with an existing session");
        (err as any).conflicts = conflicts;
        throw err;
      }
    }

    const [row] = await this.db.client
      .insert(scheduleEntryExceptions)
      .values({
        schedule_entry_id: scheduleEntryId,
        occurrence_date: new Date(dto.occurrence_date + "T00:00:00Z"),
        exception_type: dto.exception_type,
        new_date: dto.new_date ? new Date(dto.new_date + "T00:00:00Z") : null,
        new_time_slot_id: dto.new_time_slot_id ?? null,
        new_classroom_id: dto.new_classroom_id ?? null,
        new_prof_id: dto.new_prof_id ?? null,
        notes: dto.notes ?? null,
        created_by: userId ?? null,
      })
      .returning();

    await this.audit.record({
      action: "schedule.exception.created",
      entityType: "schedule_entry_exception",
      entityId: row.id,
      entityLabel: `${rule.group.name} / ${rule.timeSlot.label} @ ${dto.occurrence_date}`,
      actorId: userId,
      newValues: {
        schedule_entry_id: scheduleEntryId,
        occurrence_date: dto.occurrence_date,
        exception_type: dto.exception_type,
        new_date: dto.new_date ?? null,
        new_time_slot_id: dto.new_time_slot_id ?? null,
        new_classroom_id: dto.new_classroom_id ?? null,
        new_prof_id: dto.new_prof_id ?? null,
      },
    });

    return this.toDto(row);
  }

  async remove(id: string, userId?: string): Promise<void> {
    const existing = await this.db.client.query.scheduleEntryExceptions.findFirst({
      where: eq(scheduleEntryExceptions.id, id),
      with: {
        scheduleEntry: {
          columns: { id: true },
          with: { group: { columns: { name: true } }, timeSlot: { columns: { label: true } } },
        },
      },
    });
    if (!existing) throw new NotFoundException(`Schedule entry exception ${id} not found`);

    await this.db.client.delete(scheduleEntryExceptions).where(eq(scheduleEntryExceptions.id, id));
    await this.audit.record({
      action: "schedule.exception.removed",
      entityType: "schedule_entry_exception",
      entityId: id,
      entityLabel: existing.scheduleEntry
        ? `${existing.scheduleEntry.group.name} / ${existing.scheduleEntry.timeSlot.label}`
        : undefined,
      actorId: userId,
      prevValues: {
        occurrence_date: existing.occurrence_date.toISOString().slice(0, 10),
        exception_type: existing.exception_type,
      },
    });
  }

  async list(filters: ListEntryExceptionsDto): Promise<ScheduleEntryException[]> {
    const clauses: SQL[] = [];
    if (filters.scheduleEntryId) clauses.push(eq(scheduleEntryExceptions.schedule_entry_id, filters.scheduleEntryId));
    if (filters.from) clauses.push(gte(scheduleEntryExceptions.occurrence_date, new Date(filters.from + "T00:00:00Z")));
    if (filters.to) clauses.push(lte(scheduleEntryExceptions.occurrence_date, new Date(filters.to + "T23:59:59.999Z")));

    const rows = await this.db.client.query.scheduleEntryExceptions.findMany({
      where: clauses.length > 0 ? and(...clauses) : undefined,
      orderBy: [desc(scheduleEntryExceptions.occurrence_date)],
      with: {
        scheduleEntry: {
          columns: { id: true, group_id: true, prof_id: true, subject: true },
          with: {
            group: { columns: { id: true, name: true, color: true } },
            timeSlot: { columns: { id: true, label: true, day_of_week: true, start_time: true, end_time: true } },
            professor: { columns: { id: true, full_name: true, color: true } },
            classroom: true,
          },
        },
        newTimeSlot: true,
        newClassroom: true,
        newProfessor: { columns: { id: true, full_name: true, color: true } },
      },
    });

    return rows.map((r) => ({
      ...this.toDto(r),
      schedule_entry: r.scheduleEntry as any,
      new_time_slot: r.newTimeSlot ?? null,
      new_classroom: r.newClassroom ?? null,
      new_professor: r.newProfessor ?? null,
    })) as unknown as ScheduleEntryException[];
  }

  private validateFields(dto: CreateEntryExceptionDto): void {
    switch (dto.exception_type) {
      case "moved":
        if (!dto.new_date || !dto.new_time_slot_id) {
          throw new BadRequestException("`moved` requires new_date and new_time_slot_id");
        }
        break;
      case "substitute_prof":
        if (!dto.new_prof_id) throw new BadRequestException("`substitute_prof` requires new_prof_id");
        break;
      case "room_change":
        if (!dto.new_classroom_id) throw new BadRequestException("`room_change` requires new_classroom_id");
        break;
      case "cancelled":
        break;
    }
  }

  /** The rule must actually produce an occurrence on the given date. */
  private async assertOccurrenceExists(scheduleEntryId: string, occurrenceDate: string): Promise<void> {
    const rule = await this.db.client.query.scheduleEntries.findFirst({
      where: eq(scheduleEntries.id, scheduleEntryId),
      columns: { id: true, effective_from: true, effective_until: true },
      with: { timeSlot: { columns: { day_of_week: true } } },
    });
    if (!rule) throw new NotFoundException(`Schedule entry ${scheduleEntryId} not found`);

    const fromStr = rule.effective_from.toISOString().slice(0, 10);
    const untilStr = rule.effective_until ? rule.effective_until.toISOString().slice(0, 10) : null;
    if (occurrenceDate < fromStr || (untilStr && occurrenceDate > untilStr)) {
      throw new BadRequestException(`Occurrence date ${occurrenceDate} is outside the rule's range (${fromStr}–${untilStr ?? "open"})`);
    }
    const isoDay = (rule.timeSlot.day_of_week + 6) % 7;
    if (new Date(occurrenceDate + "T00:00:00Z").getUTCDay() !== isoDay) {
      throw new BadRequestException(`No occurrence of this rule falls on ${occurrenceDate}`);
    }
  }

  private async timeBounds(timeSlotId: string): Promise<{ start: string; end: string }> {
    const slot = await this.db.client.query.timeSlots.findFirst({
      where: eq(timeSlots.id, timeSlotId),
      columns: { start_time: true, end_time: true },
    });
    if (!slot) throw new NotFoundException(`Time slot ${timeSlotId} not found`);
    return { start: slot.start_time, end: slot.end_time };
  }

  private toDto(row: any): ScheduleEntryException {
    return {
      id: row.id,
      schedule_entry_id: row.schedule_entry_id,
      occurrence_date: (row.occurrence_date as Date).toISOString().slice(0, 10),
      exception_type: row.exception_type,
      new_date: row.new_date ? (row.new_date as Date).toISOString().slice(0, 10) : null,
      new_time_slot_id: row.new_time_slot_id,
      new_classroom_id: row.new_classroom_id,
      new_prof_id: row.new_prof_id,
      notes: row.notes,
      created_by: row.created_by,
      created_at: (row.created_at as Date).toISOString(),
    };
  }
}