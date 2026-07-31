import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

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
    await this.auditService.createLog(dto.created_by, "field.created", "field", field.id, { name: field.name });
    return field;
  }

  async updateField(id: string, dto: { name?: string; description?: string }, userId?: string) {
    await this.getField(id);
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    const updated = await this.prisma.fields.update({ where: { id }, data });
    if (userId) {
      await this.auditService.createLog(userId, "field.updated", "field", id, dto);
    }
    return updated;
  }

  async deleteField(id: string, userId?: string) {
    const field = await this.getField(id);
    await this.prisma.fields.delete({ where: { id } });
    if (userId) {
      await this.auditService.createLog(userId, "field.deleted", "field", id, { name: field.name });
    }
    return field;
  }
}
