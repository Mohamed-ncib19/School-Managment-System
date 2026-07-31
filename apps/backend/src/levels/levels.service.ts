import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

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
    if (userId) {
      await this.auditService.createLog(userId, "level.created", "level", level.id, { name: level.name });
    }
    return level;
  }

  async updateLevel(id: string, dto: { name?: string }, userId?: string) {
    await this.getLevel(id);
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    const updated = await this.prisma.levels.update({ where: { id }, data });
    if (userId) {
      await this.auditService.createLog(userId, "level.updated", "level", id, dto);
    }
    return updated;
  }

  async deleteLevel(id: string, userId?: string) {
    const level = await this.getLevel(id);
    const updated = await this.prisma.levels.update({ where: { id }, data: { is_active: false } });
    if (userId) {
      await this.auditService.createLog(userId, "level.deleted", "level", id, { name: level.name });
    }
    return updated;
  }
}
