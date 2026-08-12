import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Delete,
  Param,
  Query,
  Req,
  UseGuards,
  ParseUUIDPipe,
  Patch,
} from "@nestjs/common";
import { ApiOperation } from "@nestjs/swagger";
import { SchedulingService } from "./scheduling.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/guards/roles.guard";
import { CreateScheduleEntryDto, UpdateScheduleEntryDto, PreviewTileDto, SyncTilesDto } from "./dto/schedule-entry.dto";
import { CreateExceptionDto } from "./dto/student-exception.dto";

@Controller("scheduling")
@UseGuards(JwtAuthGuard, RolesGuard)
export class SchedulingController {
  constructor(private readonly service: SchedulingService) {}

  @Get("classrooms")
  async listClassrooms(@Query("building") building?: string, @Query("active") active?: string) {
    return this.service.listClassrooms(building, active === "true" ? true : active === "false" ? false : undefined);
  }

  @Get("classrooms/:id")
  async getClassroom(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.getClassroom(id);
  }

  @Post("classrooms")
  @Roles("super_admin")
  @ApiOperation({ summary: "Create a classroom" })
  async createClassroom(@Body() dto: any, @Req() req: any) {
    return this.service.createClassroom(dto, req.user.id);
  }

  @Put("classrooms/:id")
  @Roles("super_admin")
  async updateClassroom(@Param("id", ParseUUIDPipe) id: string, @Body() dto: any, @Req() req: any) {
    return this.service.updateClassroom(id, dto, req.user.id);
  }

  @Delete("classrooms/:id")
  @Roles("super_admin")
  async removeClassroom(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.service.removeClassroom(id, req.user.id);
  }

  @Get("time-slots")
  async listTimeSlots(@Query("dayOfWeek") dayOfWeek?: string) {
    return this.service.listTimeSlots(dayOfWeek !== undefined ? Number(dayOfWeek) : undefined);
  }

  @Post("time-slots")
  @Roles("super_admin")
  async createTimeSlot(@Body() dto: any, @Req() req: any) {
    return this.service.createTimeSlot(dto, req.user.id);
  }

  @Put("time-slots/:id")
  @Roles("super_admin")
  async updateTimeSlot(@Param("id", ParseUUIDPipe) id: string, @Body() dto: any, @Req() req: any) {
    return this.service.updateTimeSlot(id, dto, req.user.id);
  }

  @Put("time-slots/reorder")
  @Roles("super_admin")
  async reorderTimeSlots(@Body() dto: { ids: string[] }, @Req() req: any) {
    return this.service.reorderTimeSlots(dto, req.user.id);
  }

  @Delete("time-slots/:id")
  @Roles("super_admin")
  async removeTimeSlot(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.service.removeTimeSlot(id, req.user.id);
  }

  @Get("entries")
  async listEntries(
    @Query("groupId") groupId?: string,
    @Query("profId") profId?: string,
    @Query("classroomId") classroomId?: string,
    @Query("timeSlotId") timeSlotId?: string,
    @Query("date") date?: string,
    @Query("active") active?: string,
  ) {
    return this.service.listEntries({
      groupId,
      profId,
      classroomId,
      timeSlotId,
      date,
      active: active === "true" ? true : active === "false" ? false : undefined,
    });
  }

  @Get("entries/:id")
  async getEntry(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.getEntry(id);
  }

  @Post("entries")
  @Roles("super_admin")
  async createEntry(@Body() dto: CreateScheduleEntryDto, @Req() req: any) {
    return this.service.createEntry(dto, req.user.id);
  }

  @Put("entries/:id")
  @Roles("super_admin")
  async updateEntry(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateScheduleEntryDto, @Req() req: any) {
    return this.service.updateEntry(id, dto, req.user.id);
  }

  @Patch("entries/:id/archive")
  @Roles("super_admin")
  async archiveEntry(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.service.archiveEntry(id, req.user.id);
  }

  @Delete("entries/:id")
  @Roles("super_admin")
  async removeEntry(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.service.removeEntry(id, req.user.id);
  }

  @Get("students/:studentId/schedule")
  async getStudentSchedule(
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const today = new Date().toISOString().split("T")[0];
    const toDate = to ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    return this.service.getStudentSchedule(studentId, from ?? today, toDate);
  }

  @Get("groups/:groupId/schedule")
  async getGroupSchedule(
    @Param("groupId", ParseUUIDPipe) groupId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const today = new Date().toISOString().split("T")[0];
    const toDate = to ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    return this.service.getGroupSchedule(groupId, from ?? today, toDate);
  }

  @Get("professors/:profId/schedule")
  async getProfessorSchedule(
    @Param("profId", ParseUUIDPipe) profId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const today = new Date().toISOString().split("T")[0];
    const toDate = to ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    return this.service.getProfessorSchedule(profId, from ?? today, toDate);
  }

  @Get("classrooms/:id/schedule")
  async getClassroomSchedule(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const today = new Date().toISOString().split("T")[0];
    const toDate = to ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    return this.service.getClassroomSchedule(id, from ?? today, toDate);
  }

  @Post("students/:studentId/exceptions")
  @Roles("super_admin")
  async createException(@Param("studentId", ParseUUIDPipe) studentId: string, @Body() dto: CreateExceptionDto, @Req() req: any) {
    return this.service.createException(studentId, dto, req.user.id);
  }

  @Delete("exceptions/:id")
  @Roles("super_admin")
  async removeException(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.service.removeException(id, req.user.id);
  }

  @Get("conflicts")
  @Roles("super_admin")
  async scanConflicts() {
    return this.service.scanAllConflicts();
  }

  @Post("conflicts/preview")
  @Roles("super_admin")
  async previewConflicts(@Body() dto: PreviewTileDto) {
    return this.service.previewConflicts(dto);
  }

  @Post("groups/:groupId/schedule/tiles")
  @Roles("super_admin")
  async syncTiles(@Param("groupId", ParseUUIDPipe) groupId: string, @Body() dto: SyncTilesDto, @Req() req: any) {
    return this.service.syncTiles(groupId, dto.tiles, req.user.id);
  }

  @Delete("groups/:groupId/schedule/tiles/:scheduleEntryId")
  @Roles("super_admin")
  async removeTile(@Param("groupId", ParseUUIDPipe) groupId: string, @Param("scheduleEntryId", ParseUUIDPipe) scheduleEntryId: string) {
    return this.service.removeTile(groupId, scheduleEntryId);
  }

  @Get("students/:studentId/multi-group-check")
  async multiGroupCheck(@Param("studentId", ParseUUIDPipe) studentId: string) {
    return this.service.getStudentEligibility(studentId);
  }
}
