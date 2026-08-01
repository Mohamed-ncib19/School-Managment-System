import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface FieldSummary {
  id: string;
  name: string;
  description: string | null;
  professors: number;
  levels: number;
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
  levels: number;
  groups: number;
  students: number;
}

export interface LevelSummary {
  id: string;
  prof_id: string;
  name: string;
  is_active: boolean;
  groups: number;
  students: number;
}

export interface GroupSummary {
  id: string;
  level_id: string;
  name: string;
  capacity: number | null;
  schedule_notes: string | null;
  is_active: boolean;
  students: number;
}

/**
 * Roll-up counts for the hierarchy pages.
 *
 * The pages used to fetch every field, professor, level, group AND student -
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

  async fieldSummaries(): Promise<FieldSummary[]> {
    return this.prisma.$queryRaw<FieldSummary[]>`
      SELECT f.id,
             f.name,
             f.description,
             COUNT(DISTINCT p.id)::int AS professors,
             COUNT(DISTINCT l.id)::int AS levels,
             COUNT(DISTINCT g.id)::int AS groups,
             COUNT(DISTINCT s.id)::int AS students
      FROM fields f
      LEFT JOIN professors p ON p.field_id = f.id
      LEFT JOIN levels     l ON l.prof_id  = p.id
      LEFT JOIN groups     g ON g.level_id = l.id
      LEFT JOIN students   s ON s.group_id = g.id
      GROUP BY f.id, f.name, f.description, f.created_at
      ORDER BY f.created_at DESC
    `;
  }

  async professorSummaries(fieldId?: string): Promise<ProfessorSummary[]> {
    if (fieldId) {
      return this.prisma.$queryRaw<ProfessorSummary[]>`
        SELECT p.id, p.field_id, p.full_name, p.phone, p.email, p.is_active,
               COUNT(DISTINCT l.id)::int AS levels,
               COUNT(DISTINCT g.id)::int AS groups,
               COUNT(DISTINCT s.id)::int AS students
        FROM professors p
        LEFT JOIN levels   l ON l.prof_id  = p.id
        LEFT JOIN groups   g ON g.level_id = l.id
        LEFT JOIN students s ON s.group_id = g.id
        WHERE p.field_id = ${fieldId}::uuid
        GROUP BY p.id, p.field_id, p.full_name, p.phone, p.email, p.is_active, p.created_at
        ORDER BY p.created_at DESC
      `;
    }
    return this.prisma.$queryRaw<ProfessorSummary[]>`
      SELECT p.id, p.field_id, p.full_name, p.phone, p.email, p.is_active,
             COUNT(DISTINCT l.id)::int AS levels,
             COUNT(DISTINCT g.id)::int AS groups,
             COUNT(DISTINCT s.id)::int AS students
      FROM professors p
      LEFT JOIN levels   l ON l.prof_id  = p.id
      LEFT JOIN groups   g ON g.level_id = l.id
      LEFT JOIN students s ON s.group_id = g.id
      GROUP BY p.id, p.field_id, p.full_name, p.phone, p.email, p.is_active, p.created_at
      ORDER BY p.created_at DESC
    `;
  }

  async levelSummaries(profId?: string): Promise<LevelSummary[]> {
    if (profId) {
      return this.prisma.$queryRaw<LevelSummary[]>`
        SELECT l.id, l.prof_id, l.name, l.is_active,
               COUNT(DISTINCT g.id)::int AS groups,
               COUNT(DISTINCT s.id)::int AS students
        FROM levels l
        LEFT JOIN groups   g ON g.level_id = l.id
        LEFT JOIN students s ON s.group_id = g.id
        WHERE l.prof_id = ${profId}::uuid
        GROUP BY l.id, l.prof_id, l.name, l.is_active, l.created_at
        ORDER BY l.created_at DESC
      `;
    }
    return this.prisma.$queryRaw<LevelSummary[]>`
      SELECT l.id, l.prof_id, l.name, l.is_active,
             COUNT(DISTINCT g.id)::int AS groups,
             COUNT(DISTINCT s.id)::int AS students
      FROM levels l
      LEFT JOIN groups   g ON g.level_id = l.id
      LEFT JOIN students s ON s.group_id = g.id
      GROUP BY l.id, l.prof_id, l.name, l.is_active, l.created_at
      ORDER BY l.created_at DESC
    `;
  }

  async groupSummaries(levelId?: string): Promise<GroupSummary[]> {
    if (levelId) {
      return this.prisma.$queryRaw<GroupSummary[]>`
        SELECT g.id, g.level_id, g.name, g.capacity, g.schedule_notes, g.is_active,
               COUNT(s.id)::int AS students
        FROM groups g
        LEFT JOIN students s ON s.group_id = g.id
        WHERE g.level_id = ${levelId}::uuid
        GROUP BY g.id, g.level_id, g.name, g.capacity, g.schedule_notes, g.is_active, g.created_at
        ORDER BY g.created_at DESC
      `;
    }
    return this.prisma.$queryRaw<GroupSummary[]>`
      SELECT g.id, g.level_id, g.name, g.capacity, g.schedule_notes, g.is_active,
             COUNT(s.id)::int AS students
      FROM groups g
      LEFT JOIN students s ON s.group_id = g.id
      GROUP BY g.id, g.level_id, g.name, g.capacity, g.schedule_notes, g.is_active, g.created_at
      ORDER BY g.created_at DESC
    `;
  }

  /** Everything the hierarchy tree needs, in four aggregate queries. */
  async fullSummary() {
    const [fields, professors, levels, groups] = await Promise.all([
      this.fieldSummaries(),
      this.professorSummaries(),
      this.levelSummaries(),
      this.groupSummaries(),
    ]);
    return { fields, professors, levels, groups };
  }
}
