import { Injectable } from "@nestjs/common";
import { and, asc, eq, ilike, sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { classrooms } from "../../db/schema";
import type { Classroom } from "../types";

@Injectable()
export class ClassroomRepository {
  constructor(private readonly db: DbService) {}

  async list(building?: string, active?: boolean) {
    const conditions = [];
    if (building) conditions.push(ilike(classrooms.building, `%${building}%`));
    if (active !== undefined) conditions.push(eq(classrooms.is_active, active));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return this.db.client.query.classrooms.findMany({
      where,
      orderBy: [asc(classrooms.building), asc(classrooms.room_number)],
    });
  }

  async get(id: string) {
    return this.db.client.query.classrooms.findFirst({
      where: eq(classrooms.id, id),
    });
  }

  async create(data: {
    name: string;
    building?: string | null;
    floor?: string | null;
    room_number?: string | null;
    capacity?: number | null;
    equipment?: string[] | null;
    is_active?: boolean;
    color?: string | null;
  }) {
    const [row] = await this.db.client.insert(classrooms).values(data).returning();
    return row;
  }

  async update(id: string, data: Record<string, unknown>) {
    const [row] = await this.db.client
      .update(classrooms)
      .set(data)
      .where(eq(classrooms.id, id))
      .returning();
    return row;
  }

  async findDuplicate(building: string, roomNumber: string, excludeId?: string) {
    const conditions = [
      eq(classrooms.building, building),
      eq(classrooms.room_number, roomNumber),
    ];
    if (excludeId) {
      conditions.push(sql`${classrooms.id} != ${excludeId}`);
    }
    return this.db.client.query.classrooms.findFirst({
      where: and(...conditions),
    });
  }
}
