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
} from "@nestjs/common";
import { ApiOperation } from "@nestjs/swagger";
import { ProfessorsService } from "./professors.service";
import { CreateProfessorDto, UpdateProfessorDto } from "./dto/professor.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/guards/roles.guard";

@Controller("professors")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProfessorsController {
  constructor(private readonly professorsService: ProfessorsService) {}

  @Get()
  async findAll(@Query("fieldId") fieldId?: string) {
    return this.professorsService.listProfessors(fieldId);
  }

  // Declared before @Get(":id"): the literal "deleted" must win over the UUID param.
  @Get("deleted")
  @Roles("super_admin")
  async findDeleted(@Query("fieldId") fieldId?: string) {
    return this.professorsService.listDeletedProfessors(fieldId);
  }

  @Get(":id")
  async findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.professorsService.getProfessor(id);
  }

  @Post()
  @Roles("super_admin")
  async create(@Body() dto: CreateProfessorDto, @Req() req: any) {
    // `user_id` links a professor to their own staff login. Defaulting it to the
    // signed-in administrator attached every professor created without an
    // explicit account to the admin's account instead of leaving it unset.
    return this.professorsService.createProfessor(dto, req.user.id);
  }

  @Put(":id")
  @Roles("super_admin")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateProfessorDto,
    @Req() req: any,
  ) {
    return this.professorsService.updateProfessor(id, dto, req.user.id);
  }

  @Delete(":id")
  @Roles("super_admin")
  async remove(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.professorsService.deactivateProfessor(id, req.user.id);
  }

  @Post(":id/restore")
  @Roles("super_admin")
  async restore(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.professorsService.restoreProfessor(id, req.user.id);
  }

  @Delete(":id/hard")
  @Roles("super_admin")
  @ApiOperation({ summary: "Permanently delete a deactivated professor and everything beneath them" })
  async hardDelete(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.professorsService.hardDeleteProfessor(id, req.user.id);
  }
}
