import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { changedFields } from "../audit/audit.util";

@Injectable()
export class FieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listFields() {
    return this.prisma.fields.findMany({
      orderBy: { created_at: "desc" },
    });
  }

  async getField(id: string) {
    const field = await this.prisma.fields.findUnique({ where: { id } });
    if (!field) throw new NotFoundException(`Field ${id} not found`);
    return field;
  }

  async createField(dto: { name: string; description?: string; created_by: string }) {
    const field = await this.prisma.fields.create({
      data: {
        name: dto.name,
        description: dto.description,
        creator: { connect: { id: dto.created_by } },
      },
    });
    await this.auditService.record({
      action: "field.created",
      entityType: "field",
      entityId: field.id,
      entityLabel: field.name,
      actorId: dto.created_by,
      newValues: { name: field.name, description: field.description },
    });
    return field;
  }

  async updateField(id: string, dto: { name?: string; description?: string }, userId?: string) {
    const before = await this.getField(id);
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
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

  async deleteField(id: string, userId?: string) {
    const field = await this.getField(id);
    await this.prisma.fields.delete({ where: { id } });
    await this.auditService.record({
      action: "field.deleted",
      entityType: "field",
      entityId: id,
      entityLabel: field.name,
      actorId: userId,
      prevValues: { name: field.name, description: field.description },
    });
    return field;
  }
}
