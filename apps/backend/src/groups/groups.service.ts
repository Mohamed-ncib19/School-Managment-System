import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { groups, studentAssignments, students } from "../db/schema";
import { AuditService } from "../audit/audit.service";
import { changedFields } from "../audit/audit.util";
import { hardDeleteHierarchy } from "../hierarchy/hard-delete";

@Injectable()
export class GroupsService {
  constructor(
    private readonly db: DbService,
    private readonly auditService: AuditService,
  ) {}

  /** Parent chain a group carries for display: professor -> field -> level. */
  private static readonly HIERARCHY_WITH = {
    professor: { with: { field: { with: { level: true } } } },
  } as const;

  async listGroups(profId?: string) {
    const groupRows = await this.db.client.query.groups.findMany({
      where: and(eq(groups.is_active, true), profId ? eq(groups.prof_id, profId) : undefined),
      with: {
        ...GroupsService.HIERARCHY_WITH,
        // Lightweight roster preview for the group cards (student names only,
        // active enrollments — mirrors the count below). Drizzle cannot filter
        // the nested relation by student status, so fetch it (plus status) and
        // filter here, stripping the status column back out of the payload.
        assignments: {
          with: { student: { columns: { id: true, first_name: true, last_name: true, status: true } } },
        },
      },
      orderBy: [desc(groups.created_at)],
    });
    if (groupRows.length === 0) return groupRows;

    // A student counts toward every group they are enrolled in, not just their
    // legacy primary `students.group_id` — a multi-field student whose primary
    // group lives elsewhere still belongs to this group's roster.
    const counts = await this.db.client
      .select({ group_id: studentAssignments.group_id, count: sql<number>`count(*)::int` })
      .from(studentAssignments)
      .innerJoin(students, eq(studentAssignments.student_id, students.id))
      .where(and(inArray(studentAssignments.group_id, groupRows.map((g) => g.id)), eq(students.status, "active")))
      .groupBy(studentAssignments.group_id);
    const byGroup = new Map(counts.map((c) => [c.group_id, c.count]));
    return groupRows.map(({ assignments, ...group }) => ({
      ...group,
      assignments: (assignments ?? [])
        .filter((a) => a.student.status === "active")
        .map((a) => ({
          ...a,
          student: { id: a.student.id, first_name: a.student.first_name, last_name: a.student.last_name },
        })),
      _count: { students: byGroup.get(group.id) ?? 0 },
    }));
  }

  /** Archived groups - the "Deleted" space, restorable at any time. */
  async listDeletedGroups(profId?: string) {
    return this.db.client.query.groups.findMany({
      where: and(eq(groups.is_active, false), profId ? eq(groups.prof_id, profId) : undefined),
      with: GroupsService.HIERARCHY_WITH,
      orderBy: [desc(groups.created_at)],
    });
  }

  async getGroup(id: string) {
    const group = await this.db.client.query.groups.findFirst({
      where: eq(groups.id, id),
      with: GroupsService.HIERARCHY_WITH,
    });
    if (!group) throw new NotFoundException(`Groupe ${id} introuvable`);
    return group;
  }

  async createGroup(dto: {
    prof_id: string;
    name: string;
    capacity?: number;
    schedule_notes?: string;
    color?: string;
  }, userId?: string) {
    const [group] = await this.db.client
      .insert(groups)
      .values({
        prof_id: dto.prof_id,
        name: dto.name,
        capacity: dto.capacity,
        schedule_notes: dto.schedule_notes,
        color: dto.color,
      })
      .returning();
    await this.auditService.record({
      action: "group.created",
      entityType: "group",
      entityId: group.id,
      entityLabel: group.name,
      actorId: userId,
      newValues: {
        name: group.name,
        prof_id: group.prof_id,
        capacity: group.capacity,
        schedule_notes: group.schedule_notes,
        color: group.color,
      },
    });
    return group;
  }

  async updateGroup(id: string, dto: {
    name?: string;
    capacity?: number;
    schedule_notes?: string;
    color?: string;
  }, userId?: string) {
    const before = await this.getGroup(id);
    const data: Partial<typeof groups.$inferInsert> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.capacity !== undefined) data.capacity = dto.capacity;
    if (dto.schedule_notes !== undefined) data.schedule_notes = dto.schedule_notes;
    if (dto.color !== undefined) data.color = dto.color;
    const [updated] = await this.db.client
      .update(groups)
      .set(data)
      .where(eq(groups.id, id))
      .returning();

    const { prevValues, newValues, changed } = changedFields(before, data);
    await this.auditService.record({
      action: "group.updated",
      entityType: "group",
      entityId: id,
      entityLabel: updated.name,
      actorId: userId,
      prevValues,
      newValues,
      meta: { changed_fields: changed },
    });
    return updated;
  }

  /** Archive, not a row delete - enrolled students keep their group reference. */
  async deleteGroup(id: string, userId?: string) {
    const group = await this.getGroup(id);
    const [updated] = await this.db.client
      .update(groups)
      .set({ is_active: false })
      .where(eq(groups.id, id))
      .returning();
    await this.auditService.record({
      action: "group.archived",
      entityType: "group",
      entityId: id,
      entityLabel: group.name,
      actorId: userId,
      prevValues: { is_active: group.is_active },
      newValues: { is_active: false },
    });
    return updated;
  }

  /** Restores an archived group. */
  async restoreGroup(id: string, userId?: string) {
    const group = await this.getGroup(id);
    const [updated] = await this.db.client
      .update(groups)
      .set({ is_active: true })
      .where(eq(groups.id, id))
      .returning();
    await this.auditService.record({
      action: "group.restored",
      entityType: "group",
      entityId: id,
      entityLabel: group.name,
      actorId: userId,
      prevValues: { is_active: group.is_active },
      newValues: { is_active: true },
    });
    return updated;
  }

  /** Permanent purge of an archived group and its enrolled students. */
  async hardDeleteGroup(id: string, userId?: string) {
    const group = await this.getGroup(id);
    if (group.is_active) {
      throw new ConflictException(`Le groupe "${group.name}" est toujours actif - archivez-le d'abord`);
    }
    const counts = await hardDeleteHierarchy(this.db, "group", id);
    await this.auditService.record({
      action: "group.hard_deleted",
      entityType: "group",
      entityId: id,
      entityLabel: group.name,
      actorId: userId,
      prevValues: { name: group.name, prof_id: group.prof_id, is_active: group.is_active },
      meta: { purged: counts },
    });
    return { id, purged: counts };
  }
}