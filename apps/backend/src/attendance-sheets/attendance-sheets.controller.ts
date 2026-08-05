import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { AttendanceService } from "./attendance.service";
import { AttendanceGenerationService } from "./attendance-generation.service";
import { AttendancePrintService } from "./attendance-print.service";
import { AttendanceExportService } from "./attendance-export.service";
import {
  GenerateAttendanceSheetDto,
  SaveAttendanceSheetDto,
} from "./dto/attendance-sheet.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { AttendanceStudent } from "./attendance.types";

@Controller("attendance-sheets")
@UseGuards(JwtAuthGuard)
export class AttendanceSheetsController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly generation: AttendanceGenerationService,
    private readonly print: AttendancePrintService,
    private readonly exportService: AttendanceExportService,
    private readonly prisma: PrismaService,
  ) {}

  /** Everything a register is generated from, without persisting anything. */
  @Post("generate")
  async generate(@Body() dto: GenerateAttendanceSheetDto, @Req() req: any) {
    await this.attendance.assertCanAccessGroup(req.user?.id, dto.group_id);
    return this.generation.generate(dto.group_id, dto.month, dto.year, dto.sessions_count);
  }

  @Get()
  async listForGroup(@Req() req: any, @Query("groupId") groupId?: string) {
    if (!groupId) return [];
    await this.attendance.assertCanAccessGroup(req.user?.id, groupId);
    return this.attendance.listForGroup(groupId);
  }

  @Get(":id")
  async get(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const sheet = await this.attendance.get(id);
    await this.attendance.assertCanAccessGroup(req.user?.id, sheet.group_id);
    return { ...sheet, sessions: this.attendance.sessionsOf(sheet) };
  }

  @Post()
  async save(@Body() dto: SaveAttendanceSheetDto, @Req() req: any) {
    await this.attendance.assertCanAccessGroup(req.user?.id, dto.group_id);
    const sheet = await this.attendance.save(dto, req.user?.id);
    return { ...sheet, sessions: this.attendance.sessionsOf(sheet) };
  }

  /**
   * The print-ready A4 register. PDF is the browser's own "Save as PDF" from
   * this page — the same convention every printable document follows.
   */
  @Get(":id/print")
  async printSheet(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const sheet = await this.attendance.get(id);
    await this.attendance.assertCanAccessGroup(req.user?.id, sheet.group_id);

    const settings = await this.prisma.financial_settings.findUnique({ where: { singleton: "global" } });
    const academyName = settings?.academy_name || "IQ Academy";
    // The logo is embedded as a data URI straight from disk (the /uploads
    // folder is not HTTP-served), so the print head always carries the brand
    // mark even when the browser has no network access to it.
    const logoUrl = settings?.logo_path ?? null;

    const html = this.print.render(
      {
        academy_name: academyName,
        logo_url: await this.print.inlineLogo(logoUrl),
        generated_by_name: req.user?.full_name ?? null,
      },
      {
        month: sheet.month,
        year: sheet.year,
        academic_year: sheet.academic_year,
        schedule: sheet.schedule,
        teacher_name: sheet.teacher_name,
        level_name: sheet.level_name,
        field_name: sheet.field_name,
        group_name: sheet.group_name,
        students: (Array.isArray(sheet.students) ? sheet.students : []) as unknown as AttendanceStudent[],
        sessions: this.attendance.sessionsOf(sheet),
        generated_at: sheet.generated_at,
      },
    );

    res.set({ "Content-Type": "text/html; charset=utf-8" });
    res.send(html);
  }

  /** The same register as an Excel file, for teachers who keep marks there. */
  @Get(":id/export")
  async exportSheet(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const sheet = await this.attendance.get(id);
    await this.attendance.assertCanAccessGroup(req.user?.id, sheet.group_id);

    const settings = await this.prisma.financial_settings.findUnique({ where: { singleton: "global" } });
    const academyName = settings?.academy_name || "IQ Academy";

    const { buffer, filename } = await this.exportService.exportExcel(
      { academy_name: academyName },
      {
        month: sheet.month,
        year: sheet.year,
        academic_year: sheet.academic_year,
        schedule: sheet.schedule,
        teacher_name: sheet.teacher_name,
        level_name: sheet.level_name,
        field_name: sheet.field_name,
        group_name: sheet.group_name,
        students: (Array.isArray(sheet.students) ? sheet.students : []) as unknown as AttendanceStudent[],
        sessions: this.attendance.sessionsOf(sheet),
      },
    );

    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": String(buffer.length),
    });
    res.send(buffer);
  }

  @Delete(":id")
  async remove(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const sheet = await this.attendance.get(id);
    await this.attendance.assertCanAccessGroup(req.user?.id, sheet.group_id);
    return this.attendance.remove(id, req.user?.id);
  }
}
