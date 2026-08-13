import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { ClassroomRepository } from "./classroom.repository";
import { AuditService } from "../../audit/audit.service";
import { CreateClassroomDto, UpdateClassroomDto } from "../dto/classroom.dto";
import { scheduleEntries } from "../../db/schema";

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
    if (dto.is_active !== undefined) data.is_active = dto.is_active;
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

  async remove(id: string, userId?: string) {
    const existing = await this.repo.get(id);
    if (!existing) throw new NotFoundException(`Classroom ${id} not found`);

    const today = new Date();
    await this.db.client
      .update(scheduleEntries)
      .set({ is_active: false, effective_until: today })
      .where(and(eq(scheduleEntries.classroom_id, id), eq(scheduleEntries.is_active, true)));

    const deleted = await this.repo.update(id, { is_active: false });
    await this.audit.record({
      action: "schedule.classroom.archived",
      entityType: "classroom",
      entityId: id,
      entityLabel: existing.name,
      actorId: userId,
      prevValues: { is_active: true },
      newValues: { is_active: false },
    });
    return deleted;
  }
}
