import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { changedFields } from "../audit/audit.util";
import { hardDeleteHierarchy } from "../hierarchy/hard-delete";

@Injectable()
export class LevelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Level names are unique (case-insensitive, trimmed). */
  private async assertUniqueName(name: string, exceptId?: string) {
    const existing = await this.prisma.levels.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (existing) {
      throw new ConflictException(`Un niveau nommé "${existing.name}" existe déjà`);
    }
  }

  /** Levels are the root of the hierarchy, so there is no parent to filter by. */
  async listLevels() {
    const levels = await this.prisma.levels.findMany({
      where: { is_active: true },
      orderBy: { created_at: "desc" },
      // Active fields only: a soft-deleted field must not keep the level's
      // counter showing a phantom. The same shape `_count` produced before.
      include: { fields: { where: { is_active: true }, select: { id: true } } },
    });
    return levels.map(({ fields, ...level }) => ({ ...level, _count: { fields: fields.length } }));
  }

  /** Archived levels - the "Deleted" space, restorable at any time. */
  async listDeletedLevels() {
    return this.prisma.levels.findMany({
      where: { is_active: false },
      orderBy: { created_at: "desc" },
    });
  }

  async getLevel(id: string) {
    const level = await this.prisma.levels.findUnique({ where: { id } });
    if (!level) throw new NotFoundException(`Niveau ${id} introuvable`);
    return level;
  }

  async createLevel(dto: { name: string; color?: string }, userId?: string) {
    await this.assertUniqueName(dto.name);
    const level = await this.prisma.levels.create({
      data: { name: dto.name, color: dto.color },
    });
    await this.auditService.record({
      action: "level.created",
      entityType: "level",
      entityId: level.id,
      entityLabel: level.name,
      actorId: userId,
      newValues: { name: level.name, color: level.color },
    });
    return level;
  }

  async updateLevel(id: string, dto: { name?: string; color?: string }, userId?: string) {
    const before = await this.getLevel(id);
    const data: any = {};
    if (dto.name !== undefined) {
      await this.assertUniqueName(dto.name, id);
      data.name = dto.name;
    }
    if (dto.color !== undefined) data.color = dto.color;
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

  /**
   * Permanent purge of an archived level and everything beneath it. Only an
   * archived level can be hard-deleted, so a live level can never be
   * wiped out by accident from this path.
   */
  async hardDeleteLevel(id: string, userId?: string) {
    const level = await this.getLevel(id);
    if (level.is_active) {
      throw new ConflictException(`Le niveau "${level.name}" est toujours actif - archivez-le d'abord`);
    }
    const counts = await hardDeleteHierarchy(this.prisma, "level", id);
    await this.auditService.record({
      action: "level.hard_deleted",
      entityType: "level",
      entityId: id,
      entityLabel: level.name,
      actorId: userId,
      prevValues: { name: level.name, is_active: level.is_active },
      meta: { purged: counts },
    });
    return { id, purged: counts };
  }
}
