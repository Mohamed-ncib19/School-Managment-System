import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { changedFields } from "../audit/audit.util";

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listGroups(levelId?: string) {
    const where = levelId ? { level_id: levelId } : {};
    return this.prisma.groups.findMany({
      where,
      include: { level: { include: { professor: { include: { field: true } } } } },
      orderBy: { created_at: "desc" },
    });
  }

  async getGroup(id: string) {
    const group = await this.prisma.groups.findUnique({ where: { id }, include: { level: { include: { professor: { include: { field: true } } } } } });
    if (!group) throw new NotFoundException(`Group ${id} not found`);
    return group;
  }

  async createGroup(dto: {
    level_id: string;
    name: string;
    capacity?: number;
    schedule_notes?: string;
  }, userId?: string) {
    const group = await this.prisma.groups.create({
      data: {
        level_id: dto.level_id,
        name: dto.name,
        capacity: dto.capacity,
        schedule_notes: dto.schedule_notes,
      },
    });
    await this.auditService.record({
      action: "group.created",
      entityType: "group",
      entityId: group.id,
      entityLabel: group.name,
      actorId: userId,
      newValues: {
        name: group.name,
        level_id: group.level_id,
        capacity: group.capacity,
        schedule_notes: group.schedule_notes,
      },
    });
    return group;
  }

  async updateGroup(id: string, dto: {
    name?: string;
    capacity?: number;
    schedule_notes?: string;
  }, userId?: string) {
    const before = await this.getGroup(id);
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.capacity !== undefined) data.capacity = dto.capacity;
    if (dto.schedule_notes !== undefined) data.schedule_notes = dto.schedule_notes;
    const updated = await this.prisma.groups.update({ where: { id }, data });

    const { prevValues, newValues, changed } = changedFields(before, data);
    await this.auditService.record({
      action: "group.updated",
      entityType: "group",
      entityId: id,
      entityLabel: updated.name,
      actorId: userId,
      prevValues,
      newValues,
      meta: { changed_fields: changed },
    });
    return updated;
  }

  /** Archive, not a row delete - enrolled students keep their group reference. */
  async deleteGroup(id: string, userId?: string) {
    const group = await this.getGroup(id);
    const updated = await this.prisma.groups.update({ where: { id }, data: { is_active: false } });
    await this.auditService.record({
      action: "group.archived",
      entityType: "group",
      entityId: id,
      entityLabel: group.name,
      actorId: userId,
      prevValues: { is_active: group.is_active },
      newValues: { is_active: false },
    });
    return updated;
  }

  /** Restores an archived group. */
  async restoreGroup(id: string, userId?: string) {
    const group = await this.getGroup(id);
    const updated = await this.prisma.groups.update({ where: { id }, data: { is_active: true } });
    await this.auditService.record({
      action: "group.restored",
      entityType: "group",
      entityId: id,
      entityLabel: group.name,
      actorId: userId,
      prevValues: { is_active: group.is_active },
      newValues: { is_active: true },
    });
    return updated;
  }
}
