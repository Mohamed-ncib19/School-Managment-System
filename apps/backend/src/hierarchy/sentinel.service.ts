import { Injectable, BadRequestException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { levels, fields, professors, groups, students } from "../db/schema";

@Injectable()
export class SentinelService {
  constructor(private readonly db: DbService) {}

  /**
   * The holding pen for fields whose level was deleted without a chosen target.
   *
   * Unlike the others this takes no parent id: a level is the root of the
   * hierarchy, so there is exactly one of these for the whole install rather
   * than one per parent.
   */
  async ensureLevelSentinel(): Promise<string> {
    const existing = await this.db.client.query.levels.findFirst({
      where: and(eq(levels.is_system_placeholder, true), eq(levels.is_active, false)),
      columns: { id: true },
    });
    if (existing) return existing.id;

    const [row] = await this.db.client.insert(levels).values({
      name: "Unassigned",
      is_active: false,
      is_system_placeholder: true,
    }).returning();
    return row.id;
  }

  async ensureFieldSentinel(levelId: string, actorId?: string): Promise<string> {
    const existing = await this.db.client.query.fields.findFirst({
      where: and(eq(fields.level_id, levelId), eq(fields.is_system_placeholder, true), eq(fields.is_active, false)),
      columns: { id: true },
    });
    if (existing) return existing.id;

    if (!actorId) {
      const actor = await this.db.client.query.users.findFirst({ columns: { id: true } });
      actorId = actor?.id;
    }
    if (!actorId) throw new BadRequestException("No actor available to create the placeholder field");

    const [row] = await this.db.client.insert(fields).values({
      name: "Unassigned",
      level_id: levelId,
      created_by: actorId,
      is_active: false,
      is_system_placeholder: true,
      description: "System placeholder for detached fields",
    }).returning();
    return row.id;
  }

  async ensureProfessorSentinel(fieldId: string): Promise<string> {
    const existing = await this.db.client.query.professors.findFirst({
      where: and(eq(professors.field_id, fieldId), eq(professors.is_system_placeholder, true), eq(professors.is_active, false)),
      columns: { id: true },
    });
    if (existing) return existing.id;

    const [row] = await this.db.client.insert(professors).values({
      full_name: "Unassigned",
      phone: "00000000",
      field_id: fieldId,
      is_active: false,
      is_system_placeholder: true,
    }).returning();
    return row.id;
  }

  async ensureGroupSentinel(profId: string): Promise<string> {
    const existing = await this.db.client.query.groups.findFirst({
      where: and(eq(groups.prof_id, profId), eq(groups.is_system_placeholder, true), eq(groups.is_active, false)),
      columns: { id: true },
    });
    if (existing) return existing.id;

    const [row] = await this.db.client.insert(groups).values({
      name: "Unassigned",
      prof_id: profId,
      is_active: false,
      is_system_placeholder: true,
    }).returning();
    return row.id;
  }

  async ensureStudentSentinel(groupId: string): Promise<string> {
    const existing = await this.db.client.query.students.findFirst({
      where: and(eq(students.group_id, groupId), eq(students.is_system_placeholder, true), eq(students.status, "withdrawn")),
      columns: { id: true },
    });
    if (existing) return existing.id;

    const [row] = await this.db.client.insert(students).values({
      first_name: "Unassigned",
      // NOT NULL in the schema: the sentinel must satisfy it (an empty value
      // here used to force a spurious fill-value demand on every data export).
      last_name: "Unassigned",
      phone: "00000000",
      enrollment_date: new Date(),
      monthly_fee: "0",
      status: "withdrawn",
      group_id: groupId,
      is_system_placeholder: true,
    }).returning();
    return row.id;
  }

  async getUnassignedFields(levelId: string) {
    return this.db.client.query.fields.findMany({
      where: and(eq(fields.level_id, levelId), eq(fields.is_active, false), eq(fields.is_system_placeholder, true)),
      columns: { id: true, name: true },
    });
  }

  async getUnassignedProfessors(fieldId: string) {
    return this.db.client.query.professors.findMany({
      where: and(eq(professors.field_id, fieldId), eq(professors.is_active, false), eq(professors.is_system_placeholder, true)),
      columns: { id: true, full_name: true },
    });
  }

  async getUnassignedGroups(profId: string) {
    return this.db.client.query.groups.findMany({
      where: and(eq(groups.prof_id, profId), eq(groups.is_active, false), eq(groups.is_system_placeholder, true)),
      columns: { id: true, name: true },
    });
  }

  async getUnassignedStudents(groupId: string) {
    return this.db.client.query.students.findMany({
      where: and(eq(students.group_id, groupId), eq(students.is_system_placeholder, true)),
      columns: { id: true, first_name: true, last_name: true },
    });
  }
}
