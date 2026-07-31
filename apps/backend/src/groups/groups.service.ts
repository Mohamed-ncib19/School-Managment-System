import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

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
    if (userId) {
      await this.auditService.createLog(userId, "group.created", "group", group.id, { name: group.name });
    }
    return group;
  }

  async updateGroup(id: string, dto: {
    name?: string;
    capacity?: number;
    schedule_notes?: string;
  }, userId?: string) {
    await this.getGroup(id);
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.capacity !== undefined) data.capacity = dto.capacity;
    if (dto.schedule_notes !== undefined) data.schedule_notes = dto.schedule_notes;
    const updated = await this.prisma.groups.update({ where: { id }, data });
    if (userId) {
      await this.auditService.createLog(userId, "group.updated", "group", id, dto);
    }
    return updated;
  }

  async deleteGroup(id: string, userId?: string) {
    const group = await this.getGroup(id);
    const updated = await this.prisma.groups.update({ where: { id }, data: { is_active: false } });
    if (userId) {
      await this.auditService.createLog(userId, "group.deleted", "group", id, { name: group.name });
    }
    return updated;
  }
}
