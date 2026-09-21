import { Injectable, NotFoundException, ConflictException, BadRequestException } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { groups, professors } from "../db/schema";
import { AuditService } from "../audit/audit.service";
import { changedFields } from "../audit/audit.util";
import { hardDeleteHierarchy } from "../hierarchy/hard-delete";
import { normalizeTunisianPhone } from "../common/phone.util";

@Injectable()
export class ProfessorsService {
  constructor(
    private readonly db: DbService,
    private readonly auditService: AuditService,
  ) {}

  async listProfessors(fieldId?: string) {
    const rows = await this.db.client.query.professors.findMany({
      where: and(eq(professors.is_active, true), fieldId ? eq(professors.field_id, fieldId) : undefined),
      with: { field: { with: { level: true } } },
      orderBy: [desc(professors.created_at)],
    });
    const ids = rows.map((p) => p.id);
    // One grouped count query instead of N+1 `count`s.
    const counts =
      ids.length > 0
        ? await this.db.client
            .select({ prof_id: groups.prof_id, count: sql<number>`count(*)::int` })
            .from(groups)
            .where(and(inArray(groups.prof_id, ids), eq(groups.is_active, true)))
            .groupBy(groups.prof_id)
        : [];
    const countMap = new Map(counts.map((c) => [c.prof_id, c.count]));
    return rows.map((prof) => ({
      ...prof,
      _count: { groups: countMap.get(prof.id) ?? 0 },
    }));
  }

  /** Deactivated professors - the "Deleted" space, restorable at any time. */
  async listDeletedProfessors(fieldId?: string) {
    return this.db.client.query.professors.findMany({
      where: and(eq(professors.is_active, false), fieldId ? eq(professors.field_id, fieldId) : undefined),
      with: { field: { with: { level: true } } },
      orderBy: [desc(professors.created_at)],
    });
  }

  async getProfessor(id: string) {
    const prof = await this.db.client.query.professors.findFirst({
      where: eq(professors.id, id),
      with: { field: { with: { level: true } } },
    });
    if (!prof) throw new NotFoundException(`Professeur ${id} introuvable`);
    return prof;
  }

  async createProfessor(dto: {
    field_id: string;
    full_name: string;
    phone: string;
    email?: string;
    color?: string;
    user_id?: string;
  }, userId?: string) {
    const phone = normalizeTunisianPhone(dto.phone);
    if (!phone) throw new BadRequestException("Le téléphone du professeur doit comprendre 8 chiffres, ex. +216 22 123 456");
    const [prof] = await this.db.client
      .insert(professors)
      .values({
        field_id: dto.field_id,
        full_name: dto.full_name,
        phone,
        email: dto.email,
        color: dto.color,
        user_id: dto.user_id,
      })
      .returning();
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
        color: prof.color,
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
    color?: string;
    user_id?: string;
    is_active?: boolean;
  }, userId?: string) {
    const before = await this.getProfessor(id);
    const data: Partial<typeof professors.$inferInsert> = {};
    if (dto.full_name !== undefined) data.full_name = dto.full_name;
    if (dto.phone !== undefined) {
      const phone = normalizeTunisianPhone(dto.phone);
      if (!phone) throw new BadRequestException("Le téléphone du professeur doit comprendre 8 chiffres, ex. +216 22 123 456");
      data.phone = phone;
    }
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.user_id !== undefined) data.user_id = dto.user_id;
    if (dto.is_active !== undefined) data.is_active = dto.is_active;
    const [updated] = await this.db.client
      .update(professors)
      .set(data)
      .where(eq(professors.id, id))
      .returning();

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
    const [updated] = await this.db.client
      .update(professors)
      .set({ is_active: false })
      .where(eq(professors.id, id))
      .returning();
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
    const [updated] = await this.db.client
      .update(professors)
      .set({ is_active: true })
      .where(eq(professors.id, id))
      .returning();
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

  /** Permanent purge of a deactivated professor and their groups/students. */
  async hardDeleteProfessor(id: string, userId?: string) {
    const prof = await this.getProfessor(id);
    if (prof.is_active) {
      throw new ConflictException(`Le professeur "${prof.full_name}" est toujours actif - désactivez-le d'abord`);
    }
    const counts = await hardDeleteHierarchy(this.db, "professor", id);
    await this.auditService.record({
      action: "professor.hard_deleted",
      entityType: "professor",
      entityId: id,
      entityLabel: prof.full_name,
      actorId: userId,
      prevValues: { full_name: prof.full_name, field_id: prof.field_id, is_active: prof.is_active },
      meta: { purged: counts },
    });
    return { id, purged: counts };
  }
}