import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Req,
  UseGuards,
  ParseUUIDPipe,
  Delete,
  Query,
} from "@nestjs/common";
import { StudentsService } from "./students.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/guards/roles.guard";

@Controller("students")
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get()
  async findAll(@Query("groupId") groupId?: string) {
    return this.studentsService.listStudents(groupId);
  }

  @Get(":id")
  async findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.studentsService.getStudent(id);
  }

  @Get(":id/payments")
  async getPayments(@Param("id", ParseUUIDPipe) id: string) {
    return this.studentsService.getStudentPayments(id);
  }

  @Post()
  @Roles("super_admin")
  async create(@Body() dto: any, @Req() req: any) {
    return this.studentsService.createStudent(dto, req.user.id);
  }

  @Put(":id")
  @Roles("super_admin")
  async update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: any, @Req() req: any) {
    return this.studentsService.updateStudent(id, dto, req.user.id);
  }

  @Post(":id/move")
  @Roles("super_admin")
  async move(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: { group_id: string },
    @Req() req: any,
  ) {
    return this.studentsService.moveStudent(id, dto.group_id, req.user.id);
  }

  @Delete(":id")
  @Roles("super_admin")
  async delete(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.studentsService.deleteStudent(id, req.user.id);
  }
}
