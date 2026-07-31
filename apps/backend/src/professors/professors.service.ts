import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

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
  }) {
    const prof = await this.prisma.professors.create({
      data: {
        field_id: dto.field_id,
        full_name: dto.full_name,
        phone: dto.phone,
        email: dto.email,
        user_id: dto.user_id,
      },
    });
    await this.auditService.createLog(dto.user_id ?? "system", "professor.created", "professor", prof.id, { full_name: prof.full_name });
    return prof;
  }

  async updateProfessor(id: string, dto: {
    full_name?: string;
    phone?: string;
    email?: string;
    user_id?: string;
    is_active?: boolean;
  }, userId?: string) {
    await this.getProfessor(id);
    const data: any = {};
    if (dto.full_name !== undefined) data.full_name = dto.full_name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.user_id !== undefined) data.user_id = dto.user_id;
    if (dto.is_active !== undefined) data.is_active = dto.is_active;
    const updated = await this.prisma.professors.update({ where: { id }, data });
    if (userId) {
      await this.auditService.createLog(userId, "professor.updated", "professor", id, dto);
    }
    return updated;
  }

  async deactivateProfessor(id: string, userId?: string) {
    const prof = await this.getProfessor(id);
    const updated = await this.prisma.professors.update({ where: { id }, data: { is_active: false } });
    if (userId) {
      await this.auditService.createLog(userId, "professor.deactivated", "professor", id, { full_name: prof.full_name });
    }
    return updated;
  }
}
