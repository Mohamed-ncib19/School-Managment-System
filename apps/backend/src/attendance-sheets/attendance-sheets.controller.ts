import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AttendanceSheetsService } from "./attendance-sheets.service";
import { SaveAttendanceSheetDto } from "./dto/attendance-sheet.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@Controller("attendance-sheets")
@UseGuards(JwtAuthGuard)
export class AttendanceSheetsController {
  constructor(private readonly attendanceSheets: AttendanceSheetsService) {}

  @Get()
  listForGroup(@Query("groupId") groupId?: string) {
    if (!groupId) return this.attendanceSheets.listForGroup("");
    return this.attendanceSheets.listForGroup(groupId);
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.attendanceSheets.get(id);
  }

  @Post()
  save(@Body() dto: SaveAttendanceSheetDto, @Req() req: any) {
    return this.attendanceSheets.save(dto, req.user?.id);
  }

  @Delete(":id")
  remove(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.attendanceSheets.remove(id, req.user?.id);
  }
}