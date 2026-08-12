import { Injectable, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { studentScheduleExceptions } from "../../db/schema";
import { AuditService } from "../../audit/audit.service";
import { CreateExceptionDto } from "../dto/student-exception.dto";

@Injectable()
export class StudentExceptionService {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  async create(studentId: string, scheduleEntryId: string, dto: CreateExceptionDto, userId?: string) {
    const [row] = await this.db.client.insert(studentScheduleExceptions).values({
      student_id: studentId,
      schedule_entry_id: scheduleEntryId,
      exception_type: dto.exception_type,
      exception_date: new Date(dto.exception_date),
      notes: dto.notes ?? null,
      created_by: userId ?? null,
    }).returning();
    await this.audit.record({
      action: "schedule.exception.created",
      entityType: "student_schedule_exception",
      entityId: row.id,
      actorId: userId,
      newValues: { student_id: studentId, schedule_entry_id: scheduleEntryId, exception_type: dto.exception_type, exception_date: dto.exception_date },
    });
    return row;
  }

  async remove(id: string, userId?: string) {
    const [deleted] = await this.db.client.delete(studentScheduleExceptions).where(eq(studentScheduleExceptions.id, id)).returning();
    await this.audit.record({
      action: "schedule.exception.removed",
      entityType: "student_schedule_exception",
      entityId: id,
      actorId: userId,
    });
    return deleted;
  }
}
