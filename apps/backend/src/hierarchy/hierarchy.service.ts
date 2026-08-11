import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { fields, groups, levels, professors, studentAssignments, students } from "../db/schema";

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
  constructor(private readonly db: DbService) {}

  async levelSummaries(): Promise<LevelSummary[]> {
    return this.db.rawQuery<LevelSummary>(sql`
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
    `);
  }

  async fieldSummaries(levelId?: string): Promise<FieldSummary[]> {
    if (levelId) {
      return this.db.rawQuery<FieldSummary>(sql`
        SELECT f.id, f.level_id, f.name, f.description,
               COUNT(DISTINCT p.id)::int AS professors,
               COUNT(DISTINCT g.id)::int AS groups,
               COUNT(DISTINCT s.id)::int AS students
        FROM fields f
        LEFT JOIN professors p ON p.field_id = f.id AND p.is_active = true
        LEFT JOIN groups     g ON g.prof_id  = p.id AND g.is_active = true
        LEFT JOIN student_assignments sa ON sa.group_id = g.id
        LEFT JOIN students   s ON s.id = sa.student_id AND s.status = 'active'
        WHERE f.level_id = ${sql.param(levelId)}::uuid AND f.is_active = true
        GROUP BY f.id, f.level_id, f.name, f.description, f.created_at
        ORDER BY f.created_at DESC
      `);
    }
    return this.db.rawQuery<FieldSummary>(sql`
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
    `);
  }

  async professorSummaries(fieldId?: string): Promise<ProfessorSummary[]> {
    if (fieldId) {
      return this.db.rawQuery<ProfessorSummary>(sql`
        SELECT p.id, p.field_id, p.full_name, p.phone, p.email, p.is_active,
               COUNT(DISTINCT g.id)::int AS groups,
               COUNT(DISTINCT s.id)::int AS students
        FROM professors p
        LEFT JOIN groups   g ON g.prof_id  = p.id AND g.is_active = true
        LEFT JOIN student_assignments sa ON sa.group_id = g.id
        LEFT JOIN students s ON s.id = sa.student_id AND s.status = 'active'
        WHERE p.field_id = ${sql.param(fieldId)}::uuid AND p.is_active = true
        GROUP BY p.id, p.field_id, p.full_name, p.phone, p.email, p.is_active, p.created_at
        ORDER BY p.created_at DESC
      `);
    }
    return this.db.rawQuery<ProfessorSummary>(sql`
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
    `);
  }

  async groupSummaries(profId?: string): Promise<GroupSummary[]> {
    if (profId) {
      return this.db.rawQuery<GroupSummary>(sql`
        SELECT g.id, g.prof_id, g.name, g.capacity, g.schedule_notes, g.is_active,
               COUNT(s.id)::int AS students
        FROM groups g
        LEFT JOIN student_assignments sa ON sa.group_id = g.id
        LEFT JOIN students s ON s.id = sa.student_id AND s.status = 'active'
        WHERE g.prof_id = ${sql.param(profId)}::uuid AND g.is_active = true
        GROUP BY g.id, g.prof_id, g.name, g.capacity, g.schedule_notes, g.is_active, g.created_at
        ORDER BY g.created_at DESC
      `);
    }
    return this.db.rawQuery<GroupSummary>(sql`
      SELECT g.id, g.prof_id, g.name, g.capacity, g.schedule_notes, g.is_active,
             COUNT(s.id)::int AS students
      FROM groups g
      LEFT JOIN student_assignments sa ON sa.group_id = g.id
      LEFT JOIN students s ON s.id = sa.student_id AND s.status = 'active'
      WHERE g.is_active = true
      GROUP BY g.id, g.prof_id, g.name, g.capacity, g.schedule_notes, g.is_active, g.created_at
      ORDER BY g.created_at DESC
    `);
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
        return this.db.client.query.levels.findFirst({
          where: eq(levels.id, entityId),
          columns: { id: true, name: true, is_active: true },
        });
      case "field":
        return this.db.client.query.fields.findFirst({
          where: eq(fields.id, entityId),
          columns: { id: true, name: true, description: true, level_id: true },
        });
      case "professor":
        return this.db.client.query.professors.findFirst({
          where: eq(professors.id, entityId),
          columns: { id: true, full_name: true, phone: true, email: true, is_active: true, field_id: true },
        });
      case "group":
        return this.db.client.query.groups.findFirst({
          where: eq(groups.id, entityId),
          columns: { id: true, name: true, capacity: true, schedule_notes: true, is_active: true, prof_id: true },
        });
      case "student":
        return this.db.client.query.students.findFirst({
          where: eq(students.id, entityId),
          columns: { id: true, first_name: true, last_name: true, phone: true, status: true, group_id: true },
        });
      default:
        return null;
    }
  }

  private async getChildren(parentType: string, parentId: string) {
    switch (parentType) {
      case "level":
        return this.db.client.query.fields.findMany({
          where: and(eq(fields.level_id, parentId), eq(fields.is_active, true)),
          columns: { id: true, name: true, description: true },
          orderBy: [desc(fields.created_at)],
        });
      case "field":
        return this.db.client.query.professors.findMany({
          where: and(eq(professors.field_id, parentId), eq(professors.is_active, true)),
          columns: { id: true, full_name: true, phone: true, email: true, is_active: true },
          orderBy: [desc(professors.created_at)],
        });
      case "professor":
        return this.db.client.query.groups.findMany({
          where: and(eq(groups.prof_id, parentId), eq(groups.is_active, true)),
          columns: { id: true, name: true, capacity: true, schedule_notes: true, is_active: true },
          orderBy: [desc(groups.created_at)],
        });
      case "group":
        return this.db.client
          .select({
            id: students.id,
            first_name: students.first_name,
            last_name: students.last_name,
            phone: students.phone,
            status: students.status,
            monthly_fee: students.monthly_fee,
          })
          .from(students)
          .innerJoin(
            studentAssignments,
            and(eq(studentAssignments.student_id, students.id), eq(studentAssignments.group_id, parentId)),
          )
          .where(eq(students.status, "active"))
          .orderBy(asc(students.last_name));
      default:
        return [];
    }
  }
}