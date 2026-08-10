import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { randomUUID } from "node:crypto";
import { SaveAttendanceSheetDto } from "./dto/attendance-sheet.dto";
import { AttendanceSession } from "./attendance.types";

/**
 * Core persistence for monthly attendance registers.
 *
 * Each sheet is a frozen snapshot — professor, level, field, group names, the
 * teaching sessions and the student roster at generation time — so a reprint
 * always shows the list that was actually handed out, even if students have
 * since moved between groups.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Who may touch a group's registers: super admins generate anything; a
   * professor account (a user linked to a professor row) is limited to the
   * groups assigned to that professor. Everyone else is denied.
   */
  async assertCanAccessGroup(userId: string, groupId: string): Promise<void> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) throw new ForbiddenException("Compte introuvable");

    if (user.role === "super_admin") return;

    const profs = await this.prisma.professors.findMany({
      where: { user_id: userId, is_active: true },
      select: { id: true },
    });
    if (profs.length === 0) {
      throw new ForbiddenException("Seuls les super administrateurs et les professeurs concernés peuvent accéder aux feuilles de présence");
    }
    const group = await this.prisma.groups.findFirst({
      where: { id: groupId, prof_id: { in: profs.map((p) => p.id) } },
      select: { id: true },
    });
    if (!group) {
      throw new ForbiddenException("Ce groupe n'est pas assigné à votre compte");
    }
  }

  /** Every saved sheet for one group, newest first. */
  listForGroup(groupId: string) {
    return this.prisma.attendance_sheets.findMany({
      where: { group_id: groupId },
      orderBy: { generated_at: "desc" },
    });
  }

  async get(id: string) {
    const sheet = await this.prisma.attendance_sheets.findUnique({ where: { id } });
    if (!sheet) throw new NotFoundException(`Feuille de présence ${id} introuvable`);
    return sheet;
  }

  /** Normalises sessions so legacy rows (no sessions column) still print. */
  sessionsOf(sheet: { sessions: Prisma.JsonValue | null; month: number; year: number }): AttendanceSession[] {
    if (Array.isArray(sheet.sessions)) {
      return sheet.sessions as unknown as AttendanceSession[];
    }
    // Legacy sheet without stored sessions: fall back to 8 empty séances so
    // the register is never blank.
    return Array.from({ length: 8 }, () => ({ id: randomUUID() }));
  }

  async save(dto: SaveAttendanceSheetDto, userId?: string) {
    const group = await this.prisma.groups.findUnique({
      where: { id: dto.group_id },
      select: { id: true, name: true },
    });
    if (!group) {
      throw new BadRequestException(`Le groupe ${dto.group_id} n'existe pas`);
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
        field_name: dto.field_name ?? null,
        group_name: dto.group_name,
        academic_year: dto.academic_year ?? null,
        sessions: dto.sessions as unknown as Prisma.InputJsonValue,
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
        meta: {
          group_id: dto.group_id,
          month: dto.month,
          year: dto.year,
          sessions: Array.isArray(dto.sessions) ? dto.sessions.length : 0,
        },
      });
    }

    return sheet;
  }

  async remove(id: string, userId?: string) {
    const sheet = await this.prisma.attendance_sheets.findUnique({ where: { id } });
    if (!sheet) throw new NotFoundException(`Feuille de présence ${id} introuvable`);

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
