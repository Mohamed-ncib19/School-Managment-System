import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { groups, studentAssignments, students } from "../db/schema";
import { AuditService } from "../audit/audit.service";
import { changedFields } from "../audit/audit.util";
import { hardDeleteHierarchy } from "../hierarchy/hard-delete";
import { GroupScheduleService } from "../scheduling/group-schedule/group-schedule.service";
import { SentinelService } from "../hierarchy/sentinel.service";

@Injectable()
export class GroupsService {
  constructor(
    private readonly db: DbService,
    private readonly auditService: AuditService,
    private readonly groupSchedule: GroupScheduleService,
    private readonly sentinels: SentinelService,
  ) {}

  /** Parent chain a group carries for display: professor -> field -> level. */
  private static readonly HIERARCHY_WITH = {
    professor: { with: { field: { with: { level: true } } } },
  } as const;

  /**
   * The group list, with its active-student count.
   *
   * The roster itself is deliberately not fetched. It used to come back in
   * full — every enrollment, with the student attached — purely so the rows
   * could be filtered by status in Node and counted, while a second grouped
   * query counted the very same thing in SQL. Nothing renders those names (the
   * cards show the professor), so the whole roster was payload the client
   * discarded: at 192 groups it is the difference between 887 KB and 237 KB,
   * and it grows with enrolment rather than with the number of groups.
   */
  async listGroups(profId?: string) {
    const groupRows = await this.db.client.query.groups.findMany({
      where: and(eq(groups.is_active, true), profId ? eq(groups.prof_id, profId) : undefined),
      with: GroupsService.HIERARCHY_WITH,
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

    return groupRows.map((group) => ({
      ...group,
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
    scheduleTiles?: { day_of_week: number; start_time: string; end_time: string; classroom_id?: string | null }[];
    /** Set once the user has seen the professor/student clashes and chosen to proceed. */
    allowConflicts?: boolean;
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
    await this.sentinels.ensureStudentSentinel(group.id);
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

    if (dto.scheduleTiles?.length) {
      const { conflicts } = await this.groupSchedule.syncTiles(group.id, dto.scheduleTiles, dto.prof_id, {
        allowConflicts: dto.allowConflicts,
      });
      if (conflicts.length > 0) {
        return { ...group, _meta: { conflicts } };
      }
    }

    return group;
  }

  async updateGroup(id: string, dto: {
    name?: string;
    capacity?: number;
    schedule_notes?: string;
    color?: string;
    scheduleTiles?: { day_of_week: number; start_time: string; end_time: string; classroom_id?: string | null }[];
    /** Set once the user has seen the professor/student clashes and chosen to proceed. */
    allowConflicts?: boolean;
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

    // `undefined` means the caller did not touch the schedule; an empty array
    // means they cleared it. Treating the two the same made removing a group's
    // last session impossible.
    if (dto.scheduleTiles !== undefined) {
      const { conflicts } = await this.groupSchedule.syncTiles(id, dto.scheduleTiles, before.prof_id, {
        allowConflicts: dto.allowConflicts,
      });
      if (conflicts.length > 0) {
        return { ...updated, _meta: { conflicts } };
      }
    }

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