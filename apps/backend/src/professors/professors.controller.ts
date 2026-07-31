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
import { ProfessorsService } from "./professors.service";
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

  @Get(":id")
  async findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.professorsService.getProfessor(id);
  }

  @Post()
  @Roles("super_admin")
  async create(@Body() dto: { field_id: string; full_name: string; phone: string; email?: string; user_id?: string }, @Req() req: any) {
    return this.professorsService.createProfessor({ ...dto, user_id: dto.user_id ?? req.user.id });
  }

  @Put(":id")
  @Roles("super_admin")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: { full_name?: string; phone?: string; email?: string; user_id?: string; is_active?: boolean },
    @Req() req: any,
  ) {
    return this.professorsService.updateProfessor(id, dto, req.user.id);
  }

  @Delete(":id")
  @Roles("super_admin")
  async remove(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.professorsService.deactivateProfessor(id, req.user.id);
  }
}
