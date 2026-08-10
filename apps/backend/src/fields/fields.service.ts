import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { changedFields } from "../audit/audit.util";
import { hardDeleteHierarchy } from "../hierarchy/hard-delete";

@Injectable()
export class FieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listFields(levelId?: string) {
    const rows = await this.prisma.fields.findMany({
      where: { ...(levelId ? { level_id: levelId } : {}), is_active: true },
      include: {
        level: true,
      },
      orderBy: { created_at: "desc" },
    });
    const counts = await Promise.all(
      rows.map((f) =>
        this.prisma.professors.count({ where: { field_id: f.id, is_active: true } }).then((count) => ({ id: f.id, count })),
      ),
    );
    const countMap = new Map(counts.map((c) => [c.id, c.count]));
    return rows.map((field) => ({
      ...field,
      _count: { professors: countMap.get(field.id) ?? 0 },
    }));
  }

  /** Archived fields - the "Deleted" space, restorable at any time. */
  async listDeletedFields(levelId?: string) {
    return this.prisma.fields.findMany({
      where: { ...(levelId ? { level_id: levelId } : {}), is_active: false },
      include: { level: true },
      orderBy: { created_at: "desc" },
    });
  }

  async getField(id: string) {
    const field = await this.prisma.fields.findUnique({ where: { id }, include: { level: true } });
    if (!field) throw new NotFoundException(`Filière ${id} introuvable`);
    return field;
  }

  async createField(dto: {
    level_id: string;
    name: string;
    description?: string;
    color?: string;
    created_by: string;
  }) {
    const field = await this.prisma.fields.create({
      data: {
        name: dto.name,
        description: dto.description,
        color: dto.color,
        level: { connect: { id: dto.level_id } },
        creator: { connect: { id: dto.created_by } },
      },
    });
    await this.auditService.record({
      action: "field.created",
      entityType: "field",
      entityId: field.id,
      entityLabel: field.name,
      actorId: dto.created_by,
      newValues: { name: field.name, description: field.description, color: field.color, level_id: field.level_id },
    });
    return field;
  }

  /** `level_id` is editable: a field can be moved to a different level. */
  async updateField(
    id: string,
    dto: { name?: string; description?: string; level_id?: string; color?: string },
    userId?: string,
  ) {
    const before = await this.getField(id);
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.level_id !== undefined) data.level_id = dto.level_id;
    if (dto.color !== undefined) data.color = dto.color;
    const updated = await this.prisma.fields.update({ where: { id }, data });

    const { prevValues, newValues, changed } = changedFields(before, data);
    await this.auditService.record({
      action: "field.updated",
      entityType: "field",
      entityId: id,
      entityLabel: updated.name,
      actorId: userId,
      prevValues,
      newValues,
      meta: { changed_fields: changed },
    });
    return updated;
  }

  /** Archive, not a row delete - professors/groups keep their field reference. */
  async deleteField(id: string, userId?: string) {
    const field = await this.getField(id);
    const updated = await this.prisma.fields.update({ where: { id }, data: { is_active: false } });
    await this.auditService.record({
      action: "field.archived",
      entityType: "field",
      entityId: id,
      entityLabel: field.name,
      actorId: userId,
      prevValues: { is_active: field.is_active },
      newValues: { is_active: false },
    });
    return updated;
  }

  /** Restores an archived field. */
  async restoreField(id: string, userId?: string) {
    const field = await this.getField(id);
    const updated = await this.prisma.fields.update({ where: { id }, data: { is_active: true } });
    await this.auditService.record({
      action: "field.restored",
      entityType: "field",
      entityId: id,
      entityLabel: field.name,
      actorId: userId,
      prevValues: { is_active: field.is_active },
      newValues: { is_active: true },
    });
    return updated;
  }

  /** Permanent purge of an archived field and its professors/groups/students. */
  async hardDeleteField(id: string, userId?: string) {
    const field = await this.getField(id);
    if (field.is_active) {
      throw new ConflictException(`La filière "${field.name}" est toujours active - archivez-la d'abord`);
    }
    const counts = await hardDeleteHierarchy(this.prisma, "field", id);
    await this.auditService.record({
      action: "field.hard_deleted",
      entityType: "field",
      entityId: id,
      entityLabel: field.name,
      actorId: userId,
      prevValues: { name: field.name, level_id: field.level_id, is_active: field.is_active },
      meta: { purged: counts },
    });
    return { id, purged: counts };
  }
}
