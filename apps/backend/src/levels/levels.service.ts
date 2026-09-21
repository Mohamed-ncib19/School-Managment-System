import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { levels } from "../db/schema";
import { AuditService } from "../audit/audit.service";
import { changedFields } from "../audit/audit.util";
import { hardDeleteHierarchy } from "../hierarchy/hard-delete";

@Injectable()
export class LevelsService {
  constructor(
    private readonly db: DbService,
    private readonly auditService: AuditService,
  ) {}

  /** Level names are unique (case-insensitive, trimmed). */
  private async assertUniqueName(name: string, exceptId?: string) {
    const existing = await this.db.client.query.levels.findFirst({
      where: and(
        sql`lower(${levels.name}) = ${name.toLowerCase()}`,
        exceptId ? ne(levels.id, exceptId) : undefined,
      ),
    });
    if (existing) {
      throw new ConflictException(`Un niveau nommé "${existing.name}" existe déjà`);
    }
  }

  /** Levels are the root of the hierarchy, so there is no parent to filter by. */
  async listLevels() {
    const [rows, counts] = await Promise.all([
      this.db.client.query.levels.findMany({
        where: eq(levels.is_active, true),
        orderBy: [desc(levels.created_at)],
      }),
      // Active fields only: a soft-deleted field must not keep the level's
      // counter showing a phantom. One grouped query instead of N+1.
      this.db.rawQuery<{ level_id: string; cnt: number }>(
        sql`SELECT level_id, COUNT(*)::int AS cnt
            FROM fields
            WHERE is_active = TRUE
            GROUP BY level_id`,
      ),
    ]);
    const byLevel = new Map(counts.map((c) => [c.level_id, c.cnt]));
    return rows.map((level) => ({ ...level, _count: { fields: byLevel.get(level.id) ?? 0 } }));
  }

  /** Archived levels - the "Deleted" space, restorable at any time. */
  async listDeletedLevels() {
    return this.db.client.query.levels.findMany({
      where: eq(levels.is_active, false),
      orderBy: [desc(levels.created_at)],
    });
  }

  async getLevel(id: string) {
    const level = await this.db.client.query.levels.findFirst({
      where: eq(levels.id, id),
    });
    if (!level) throw new NotFoundException(`Niveau ${id} introuvable`);
    return level;
  }

  async createLevel(dto: { name: string; color?: string }, userId?: string) {
    await this.assertUniqueName(dto.name);
    const [level] = await this.db.client
      .insert(levels)
      .values({ name: dto.name, color: dto.color })
      .returning();
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
    const data: Partial<typeof levels.$inferInsert> = {};
    if (dto.name !== undefined) {
      await this.assertUniqueName(dto.name, id);
      data.name = dto.name;
    }
    if (dto.color !== undefined) data.color = dto.color;
    const [updated] = await this.db.client
      .update(levels)
      .set(data)
      .where(eq(levels.id, id))
      .returning();

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
    const [updated] = await this.db.client
      .update(levels)
      .set({ is_active: false })
      .where(eq(levels.id, id))
      .returning();
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
    const [updated] = await this.db.client
      .update(levels)
      .set({ is_active: true })
      .where(eq(levels.id, id))
      .returning();
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
    const counts = await hardDeleteHierarchy(this.db, "level", id);
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