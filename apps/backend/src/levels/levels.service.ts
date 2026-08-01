import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { changedFields } from "../audit/audit.util";

@Injectable()
export class LevelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listLevels(profId?: string) {
    const where = profId ? { prof_id: profId } : {};
    return this.prisma.levels.findMany({
      where,
      include: { professor: { include: { field: true } } },
      orderBy: { created_at: "desc" },
    });
  }

  async getLevel(id: string) {
    const level = await this.prisma.levels.findUnique({ where: { id }, include: { professor: { include: { field: true } } } });
    if (!level) throw new NotFoundException(`Level ${id} not found`);
    return level;
  }

  async createLevel(dto: { prof_id: string; name: string }, userId?: string) {
    const level = await this.prisma.levels.create({
      data: { prof_id: dto.prof_id, name: dto.name },
    });
    await this.auditService.record({
      action: "level.created",
      entityType: "level",
      entityId: level.id,
      entityLabel: level.name,
      actorId: userId,
      newValues: { name: level.name, prof_id: level.prof_id },
    });
    return level;
  }

  async updateLevel(id: string, dto: { name?: string }, userId?: string) {
    const before = await this.getLevel(id);
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    const updated = await this.prisma.levels.update({ where: { id }, data });

    const { prevValues, newValues, changed } = changedFields(before, data);
    await this.auditService.record({
      action: "level.updated",
      entityType: "level",
      entityId: id,
      entityLabel: updated.name,
      actorId: userId,
      prevValues,
      newValues,
      meta: { changed_fields: changed },
    });
    return updated;
  }

  /** Archive, not a row delete - the level keeps its history. */
  async deleteLevel(id: string, userId?: string) {
    const level = await this.getLevel(id);
    const updated = await this.prisma.levels.update({ where: { id }, data: { is_active: false } });
    await this.auditService.record({
      action: "level.archived",
      entityType: "level",
      entityId: id,
      entityLabel: level.name,
      actorId: userId,
      prevValues: { is_active: level.is_active },
      newValues: { is_active: false },
    });
    return updated;
  }

  /** Restores an archived level. */
  async restoreLevel(id: string, userId?: string) {
    const level = await this.getLevel(id);
    const updated = await this.prisma.levels.update({ where: { id }, data: { is_active: true } });
    await this.auditService.record({
      action: "level.restored",
      entityType: "level",
      entityId: id,
      entityLabel: level.name,
      actorId: userId,
      prevValues: { is_active: level.is_active },
      newValues: { is_active: true },
    });
    return updated;
  }
}
