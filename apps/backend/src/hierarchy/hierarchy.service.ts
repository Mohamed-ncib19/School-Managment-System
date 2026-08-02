import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface LevelSummary {
  id: string;
  name: string;
  is_active: boolean;
  fields: number;
  professors: number;
  groups: number;
  students: number;
}

export interface FieldSummary {
  id: string;
  level_id: string;
  name: string;
  description: string | null;
  professors: number;
  groups: number;
  students: number;
}

export interface ProfessorSummary {
  id: string;
  field_id: string;
  full_name: string;
  phone: string;
  email: string | null;
  is_active: boolean;
  groups: number;
  students: number;
}

export interface GroupSummary {
  id: string;
  prof_id: string;
  name: string;
  capacity: number | null;
  schedule_notes: string | null;
  is_active: boolean;
  students: number;
}

/**
 * Roll-up counts for the hierarchy pages.
 *
 * The pages used to fetch every level, field, professor, group AND student -
 * 384 KB of student rows alone, each carrying its whole parent chain - purely
 * to count them in the browser. These aggregate in SQL instead: one indexed
 * query per level, a fraction of a kilobyte on the wire, and the counts stay
 * correct no matter how large the school grows.
 *
 * COUNT(DISTINCT ...) is required because the joins fan out: a field with three
 * professors and ten students would otherwise report thirty.
 */
@Injectable()
export class HierarchyService {
  constructor(private readonly prisma: PrismaService) {}

  async levelSummaries(): Promise<LevelSummary[]> {
    return this.prisma.$queryRaw<LevelSummary[]>`
      SELECT l.id,
             l.name,
             l.is_active,
             COUNT(DISTINCT f.id)::int AS fields,
             COUNT(DISTINCT p.id)::int AS professors,
             COUNT(DISTINCT g.id)::int AS groups,
             COUNT(DISTINCT s.id)::int AS students
      FROM levels     l
      LEFT JOIN fields     f ON f.level_id = l.id AND f.is_active = true
      LEFT JOIN professors p ON p.field_id = f.id AND p.is_active = true
      LEFT JOIN groups     g ON g.prof_id  = p.id AND g.is_active = true
      LEFT JOIN student_assignments sa ON sa.group_id = g.id
      LEFT JOIN students   s ON s.id = sa.student_id AND s.status = 'active'
      WHERE l.is_active = true
      GROUP BY l.id, l.name, l.is_active, l.created_at
      ORDER BY l.created_at DESC
    `;
  }

  async fieldSummaries(levelId?: string): Promise<FieldSummary[]> {
    if (levelId) {
      return this.prisma.$queryRaw<FieldSummary[]>`
        SELECT f.id, f.level_id, f.name, f.description,
               COUNT(DISTINCT p.id)::int AS professors,
               COUNT(DISTINCT g.id)::int AS groups,
               COUNT(DISTINCT s.id)::int AS students
        FROM fields f
        LEFT JOIN professors p ON p.field_id = f.id AND p.is_active = true
        LEFT JOIN groups     g ON g.prof_id  = p.id AND g.is_active = true
        LEFT JOIN student_assignments sa ON sa.group_id = g.id
      LEFT JOIN students   s ON s.id = sa.student_id AND s.status = 'active'
        WHERE f.level_id = ${levelId}::uuid AND f.is_active = true
        GROUP BY f.id, f.level_id, f.name, f.description, f.created_at
        ORDER BY f.created_at DESC
      `;
    }
    return this.prisma.$queryRaw<FieldSummary[]>`
      SELECT f.id, f.level_id, f.name, f.description,
             COUNT(DISTINCT p.id)::int AS professors,
             COUNT(DISTINCT g.id)::int AS groups,
             COUNT(DISTINCT s.id)::int AS students
      FROM fields f
      LEFT JOIN professors p ON p.field_id = f.id AND p.is_active = true
      LEFT JOIN groups     g ON g.prof_id  = p.id AND g.is_active = true
      LEFT JOIN student_assignments sa ON sa.group_id = g.id
      LEFT JOIN students   s ON s.id = sa.student_id AND s.status = 'active'
      WHERE f.is_active = true
      GROUP BY f.id, f.level_id, f.name, f.description, f.created_at
      ORDER BY f.created_at DESC
    `;
  }

  async professorSummaries(fieldId?: string): Promise<ProfessorSummary[]> {
    if (fieldId) {
      return this.prisma.$queryRaw<ProfessorSummary[]>`
        SELECT p.id, p.field_id, p.full_name, p.phone, p.email, p.is_active,
               COUNT(DISTINCT g.id)::int AS groups,
               COUNT(DISTINCT s.id)::int AS students
        FROM professors p
        LEFT JOIN groups   g ON g.prof_id  = p.id AND g.is_active = true
        LEFT JOIN student_assignments sa ON sa.group_id = g.id
      LEFT JOIN students s ON s.id = sa.student_id AND s.status = 'active'
        WHERE p.field_id = ${fieldId}::uuid AND p.is_active = true
        GROUP BY p.id, p.field_id, p.full_name, p.phone, p.email, p.is_active, p.created_at
        ORDER BY p.created_at DESC
      `;
    }
    return this.prisma.$queryRaw<ProfessorSummary[]>`
      SELECT p.id, p.field_id, p.full_name, p.phone, p.email, p.is_active,
             COUNT(DISTINCT g.id)::int AS groups,
             COUNT(DISTINCT s.id)::int AS students
      FROM professors p
      LEFT JOIN groups   g ON g.prof_id  = p.id AND g.is_active = true
      LEFT JOIN student_assignments sa ON sa.group_id = g.id
      LEFT JOIN students s ON s.id = sa.student_id AND s.status = 'active'
      WHERE p.is_active = true
      GROUP BY p.id, p.field_id, p.full_name, p.phone, p.email, p.is_active, p.created_at
      ORDER BY p.created_at DESC
    `;
  }

  async groupSummaries(profId?: string): Promise<GroupSummary[]> {
    if (profId) {
      return this.prisma.$queryRaw<GroupSummary[]>`
        SELECT g.id, g.prof_id, g.name, g.capacity, g.schedule_notes, g.is_active,
               COUNT(s.id)::int AS students
        FROM groups g
        LEFT JOIN student_assignments sa ON sa.group_id = g.id
      LEFT JOIN students s ON s.id = sa.student_id AND s.status = 'active'
        WHERE g.prof_id = ${profId}::uuid AND g.is_active = true
        GROUP BY g.id, g.prof_id, g.name, g.capacity, g.schedule_notes, g.is_active, g.created_at
        ORDER BY g.created_at DESC
      `;
    }
    return this.prisma.$queryRaw<GroupSummary[]>`
      SELECT g.id, g.prof_id, g.name, g.capacity, g.schedule_notes, g.is_active,
             COUNT(s.id)::int AS students
      FROM groups g
      LEFT JOIN student_assignments sa ON sa.group_id = g.id
      LEFT JOIN students s ON s.id = sa.student_id AND s.status = 'active'
      WHERE g.is_active = true
      GROUP BY g.id, g.prof_id, g.name, g.capacity, g.schedule_notes, g.is_active, g.created_at
      ORDER BY g.created_at DESC
    `;
  }

  /** Everything the hierarchy tree needs, in four aggregate queries. */
  async fullSummary() {
    const [levels, fields, professors, groups] = await Promise.all([
      this.levelSummaries(),
      this.fieldSummaries(),
      this.professorSummaries(),
      this.groupSummaries(),
    ]);
    return { levels, fields, professors, groups };
  }

  /**
   * Resolve a hierarchy path: given a sequence of {entityType, entityId} pairs,
   * return the entities in the path (for breadcrumbs) and the children of the
   * last entity (for navigation cards).
   */
  async resolvePath(segments: { entityType: string; entityId: string }[]) {
    const breadcrumbs: any[] = [];

    for (const segment of segments) {
      const entity = await this.getEntity(segment.entityType, segment.entityId);
      if (!entity) return null;
      breadcrumbs.push({ type: segment.entityType, ...entity });
    }

    const lastSegment = segments[segments.length - 1];
    const children = lastSegment
      ? await this.getChildren(lastSegment.entityType, lastSegment.entityId)
      : [];

    return { breadcrumbs, children };
  }

  private async getEntity(entityType: string, entityId: string) {
    switch (entityType) {
      case "level":
        return this.prisma.levels.findUnique({ where: { id: entityId }, select: { id: true, name: true, is_active: true } });
      case "field":
        return this.prisma.fields.findUnique({ where: { id: entityId }, select: { id: true, name: true, description: true, level_id: true } });
      case "professor":
        return this.prisma.professors.findUnique({ where: { id: entityId }, select: { id: true, full_name: true, phone: true, email: true, is_active: true, field_id: true } });
      case "group":
        return this.prisma.groups.findUnique({ where: { id: entityId }, select: { id: true, name: true, capacity: true, schedule_notes: true, is_active: true, prof_id: true } });
      case "student":
        return this.prisma.students.findUnique({ where: { id: entityId }, select: { id: true, first_name: true, last_name: true, phone: true, status: true, group_id: true } });
      default:
        return null;
    }
  }

  private async getChildren(parentType: string, parentId: string) {
    switch (parentType) {
      case "level":
        return this.prisma.fields.findMany({
          where: { level_id: parentId, is_active: true },
          select: { id: true, name: true, description: true },
          orderBy: { created_at: "desc" },
        });
      case "field":
        return this.prisma.professors.findMany({
          where: { field_id: parentId, is_active: true },
          select: { id: true, full_name: true, phone: true, email: true, is_active: true },
          orderBy: { created_at: "desc" },
        });
      case "professor":
        return this.prisma.groups.findMany({
          where: { prof_id: parentId, is_active: true },
          select: { id: true, name: true, capacity: true, schedule_notes: true, is_active: true },
          orderBy: { created_at: "desc" },
        });
      case "group":
        return this.prisma.students.findMany({
          where: { assignments: { some: { group_id: parentId } }, status: "active" },
          select: { id: true, first_name: true, last_name: true, phone: true, status: true, monthly_fee: true },
          orderBy: { last_name: "asc" },
        });
      default:
        return [];
    }
  }
}
