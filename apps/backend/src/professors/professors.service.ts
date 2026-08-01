import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { changedFields } from "../audit/audit.util";

@Injectable()
export class ProfessorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listProfessors(fieldId?: string) {
    const where = fieldId ? { field_id: fieldId } : {};
    return this.prisma.professors.findMany({
      where,
      include: { field: true },
      orderBy: { created_at: "desc" },
    });
  }

  async getProfessor(id: string) {
    const prof = await this.prisma.professors.findUnique({ where: { id }, include: { field: true } });
    if (!prof) throw new NotFoundException(`Professor ${id} not found`);
    return prof;
  }

  async createProfessor(dto: {
    field_id: string;
    full_name: string;
    phone: string;
    email?: string;
    user_id?: string;
  }, userId?: string) {
    const prof = await this.prisma.professors.create({
      data: {
        field_id: dto.field_id,
        full_name: dto.full_name,
        phone: dto.phone,
        email: dto.email,
        user_id: dto.user_id,
      },
    });
    // The actor is the administrator performing the action. `dto.user_id` is the
    // staff account being linked TO the professor - crediting it as the actor
    // attributed the change to the wrong person entirely.
    await this.auditService.record({
      action: "professor.created",
      entityType: "professor",
      entityId: prof.id,
      entityLabel: prof.full_name,
      actorId: userId,
      newValues: {
        full_name: prof.full_name,
        phone: prof.phone,
        email: prof.email,
        field_id: prof.field_id,
        user_id: prof.user_id,
      },
    });
    return prof;
  }

  async updateProfessor(id: string, dto: {
    full_name?: string;
    phone?: string;
    email?: string;
    user_id?: string;
    is_active?: boolean;
  }, userId?: string) {
    const before = await this.getProfessor(id);
    const data: any = {};
    if (dto.full_name !== undefined) data.full_name = dto.full_name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.user_id !== undefined) data.user_id = dto.user_id;
    if (dto.is_active !== undefined) data.is_active = dto.is_active;
    const updated = await this.prisma.professors.update({ where: { id }, data });

    const { prevValues, newValues, changed } = changedFields(before, data);
    // A change to the linked staff account is an access change, not a detail edit.
    const isAccountChange = changed.includes("user_id");
    await this.auditService.record({
      action: isAccountChange ? "professor.account_linked" : "professor.updated",
      entityType: "professor",
      entityId: id,
      entityLabel: updated.full_name,
      actorId: userId,
      prevValues,
      newValues,
      meta: { changed_fields: changed },
    });
    return updated;
  }

  async deactivateProfessor(id: string, userId?: string) {
    const prof = await this.getProfessor(id);
    const updated = await this.prisma.professors.update({ where: { id }, data: { is_active: false } });
    await this.auditService.record({
      action: "professor.deactivated",
      entityType: "professor",
      entityId: id,
      entityLabel: prof.full_name,
      actorId: userId,
      prevValues: { is_active: prof.is_active },
      newValues: { is_active: false },
    });
    return updated;
  }

  /** Reactivates a deactivated professor. */
  async restoreProfessor(id: string, userId?: string) {
    const prof = await this.getProfessor(id);
    const updated = await this.prisma.professors.update({ where: { id }, data: { is_active: true } });
    await this.auditService.record({
      action: "professor.restored",
      entityType: "professor",
      entityId: id,
      entityLabel: prof.full_name,
      actorId: userId,
      prevValues: { is_active: prof.is_active },
      newValues: { is_active: true },
    });
    return updated;
  }
}
