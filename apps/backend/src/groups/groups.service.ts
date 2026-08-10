import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { changedFields } from "../audit/audit.util";
import { hardDeleteHierarchy } from "../hierarchy/hard-delete";

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Parent chain a group carries for display: professor -> field -> level. */
  private static readonly HIERARCHY_INCLUDE = {
    professor: { include: { field: { include: { level: true } } } },
  } as const;

  async listGroups(profId?: string) {
    const where = { ...(profId ? { prof_id: profId } : {}), is_active: true };
    const groups = await this.prisma.groups.findMany({
      where,
      include: {
        ...GroupsService.HIERARCHY_INCLUDE,
        // Lightweight roster preview for the group cards (student names only,
        // active enrollments — mirrors the count below).
        assignments: {
          where: { student: { status: "active" } },
          include: { student: { select: { id: true, first_name: true, last_name: true } } },
        },
      },
      orderBy: { created_at: "desc" },
    });
    if (groups.length === 0) return groups;

    // A student counts toward every group they are enrolled in, not just their
    // legacy primary `students.group_id` — a multi-field student whose primary
    // group lives elsewhere still belongs to this group's roster.
    const counts = await this.prisma.student_assignments.groupBy({
      by: ["group_id"],
      where: {
        group_id: { in: groups.map((g) => g.id) },
        student: { status: "active" },
      },
      _count: { _all: true },
    });
    const byGroup = new Map(counts.map((c) => [c.group_id, c._count._all]));
    return groups.map((g) => ({ ...g, _count: { students: byGroup.get(g.id) ?? 0 } }));
  }

  /** Archived groups - the "Deleted" space, restorable at any time. */
  async listDeletedGroups(profId?: string) {
    const where = { ...(profId ? { prof_id: profId } : {}), is_active: false };
    return this.prisma.groups.findMany({
      where,
      include: GroupsService.HIERARCHY_INCLUDE,
      orderBy: { created_at: "desc" },
    });
  }

  async getGroup(id: string) {
    const group = await this.prisma.groups.findUnique({
      where: { id },
      include: GroupsService.HIERARCHY_INCLUDE,
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
    const group = await this.prisma.groups.create({
      data: {
        prof_id: dto.prof_id,
        name: dto.name,
        capacity: dto.capacity,
        schedule_notes: dto.schedule_notes,
        color: dto.color,
      },
    });
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
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.capacity !== undefined) data.capacity = dto.capacity;
    if (dto.schedule_notes !== undefined) data.schedule_notes = dto.schedule_notes;
    if (dto.color !== undefined) data.color = dto.color;
    const updated = await this.prisma.groups.update({ where: { id }, data });

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
    const updated = await this.prisma.groups.update({ where: { id }, data: { is_active: false } });
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
    const updated = await this.prisma.groups.update({ where: { id }, data: { is_active: true } });
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
    const counts = await hardDeleteHierarchy(this.prisma, "group", id);
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
