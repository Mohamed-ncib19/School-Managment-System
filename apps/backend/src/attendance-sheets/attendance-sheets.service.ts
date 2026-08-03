import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SaveAttendanceSheetDto } from "./dto/attendance-sheet.dto";

/**
 * Persists generated monthly attendance sheets.
 *
 * Each sheet is a frozen snapshot — teacher, group and level names plus the
 * student roster at generation time — so a reprint always shows the list that
 * was actually handed out, even if students have since moved between groups.
 */
@Injectable()
export class AttendanceSheetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every saved sheet for one group, newest first. */
  listForGroup(groupId: string) {
    return this.prisma.attendance_sheets.findMany({
      where: { group_id: groupId },
      orderBy: { generated_at: "desc" },
    });
  }

  async get(id: string) {
    const sheet = await this.prisma.attendance_sheets.findUnique({ where: { id } });
    if (!sheet) throw new NotFoundException(`Attendance sheet ${id} not found`);
    return sheet;
  }

  async save(dto: SaveAttendanceSheetDto, userId?: string) {
    const group = await this.prisma.groups.findUnique({
      where: { id: dto.group_id },
      select: { id: true, name: true },
    });
    if (!group) {
      throw new BadRequestException(`Group ${dto.group_id} does not exist`);
    }

    const sheet = await this.prisma.attendance_sheets.create({
      data: {
        group_id: dto.group_id,
        month: dto.month,
        year: dto.year,
        schedule: dto.schedule ?? null,
        teacher_id: dto.teacher_id ?? null,
        teacher_name: dto.teacher_name,
        level_name: dto.level_name,
        group_name: dto.group_name,
        students: dto.students as Prisma.InputJsonValue,
        generated_by: userId ?? null,
      },
    });

    if (userId) {
      await this.audit.record({
        action: "attendance_sheet.saved",
        entityType: "attendance_sheet",
        entityId: sheet.id,
        entityLabel: `${dto.group_name} · ${dto.month}/${dto.year}`,
        actorId: userId,
        meta: { group_id: dto.group_id, month: dto.month, year: dto.year },
      });
    }

    return sheet;
  }

  async remove(id: string, userId?: string) {
    const sheet = await this.prisma.attendance_sheets.findUnique({ where: { id } });
    if (!sheet) throw new NotFoundException(`Attendance sheet ${id} not found`);

    await this.prisma.attendance_sheets.delete({ where: { id } });

    if (userId) {
      await this.audit.record({
        action: "attendance_sheet.deleted",
        entityType: "attendance_sheet",
        entityId: id,
        entityLabel: `${sheet.group_name} · ${sheet.month}/${sheet.year}`,
        actorId: userId,
      });
    }
  }
}