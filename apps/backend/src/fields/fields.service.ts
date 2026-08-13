import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { fields, professors } from "../db/schema";
import { AuditService } from "../audit/audit.service";
import { changedFields } from "../audit/audit.util";
import { hardDeleteHierarchy } from "../hierarchy/hard-delete";
import { SentinelService } from "../hierarchy/sentinel.service";

@Injectable()
export class FieldsService {
  constructor(
    private readonly db: DbService,
    private readonly auditService: AuditService,
    private readonly sentinels: SentinelService,
  ) {}

  async listFields(levelId?: string) {
    const rows = await this.db.client.query.fields.findMany({
      where: and(eq(fields.is_active, true), levelId ? eq(fields.level_id, levelId) : undefined),
      with: { level: true },
      orderBy: [desc(fields.created_at)],
    });
    const ids = rows.map((f) => f.id);
    // One grouped count query instead of N+1 `count`s.
    const counts =
      ids.length > 0
        ? await this.db.client
            .select({ field_id: professors.field_id, count: sql<number>`count(*)::int` })
            .from(professors)
            .where(and(inArray(professors.field_id, ids), eq(professors.is_active, true)))
            .groupBy(professors.field_id)
        : [];
    const countMap = new Map(counts.map((c) => [c.field_id, c.count]));
    return rows.map((field) => ({
      ...field,
      _count: { professors: countMap.get(field.id) ?? 0 },
    }));
  }

  /** Archived fields - the "Deleted" space, restorable at any time. */
  async listDeletedFields(levelId?: string) {
    return this.db.client.query.fields.findMany({
      where: and(eq(fields.is_active, false), levelId ? eq(fields.level_id, levelId) : undefined),
      with: { level: true },
      orderBy: [desc(fields.created_at)],
    });
  }

  async getField(id: string) {
    const field = await this.db.client.query.fields.findFirst({
      where: eq(fields.id, id),
      with: { level: true },
    });
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
    const [field] = await this.db.client
      .insert(fields)
      .values({
        name: dto.name,
        description: dto.description,
        color: dto.color,
        level_id: dto.level_id,
        created_by: dto.created_by,
      })
      .returning();
    await this.sentinels.ensureProfessorSentinel(field.id);
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
    const data: Partial<typeof fields.$inferInsert> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.level_id !== undefined) data.level_id = dto.level_id;
    if (dto.color !== undefined) data.color = dto.color;
    const [updated] = await this.db.client
      .update(fields)
      .set(data)
      .where(eq(fields.id, id))
      .returning();

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
    const [updated] = await this.db.client
      .update(fields)
      .set({ is_active: false })
      .where(eq(fields.id, id))
      .returning();
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
    const [updated] = await this.db.client
      .update(fields)
      .set({ is_active: true })
      .where(eq(fields.id, id))
      .returning();
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
    const counts = await hardDeleteHierarchy(this.db, "field", id);
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