import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Delete,
  Param,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from "@nestjs/common";
import { FieldsService } from "./fields.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/guards/roles.guard";

@Controller("fields")
@UseGuards(JwtAuthGuard, RolesGuard)
export class FieldsController {
  constructor(private readonly fieldsService: FieldsService) {}

  @Get()
  async findAll() {
    return this.fieldsService.listFields();
  }

  @Get(":id")
  async findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.fieldsService.getField(id);
  }

  @Post()
  @Roles("super_admin")
  async create(@Body() dto: { name: string; description?: string }, @Req() req: any) {
    return this.fieldsService.createField({ ...dto, created_by: req.user.id });
  }

  @Put(":id")
  @Roles("super_admin")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: { name?: string; description?: string },
    @Req() req: any,
  ) {
    return this.fieldsService.updateField(id, dto, req.user.id);
  }

  @Delete(":id")
  @Roles("super_admin")
  async remove(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.fieldsService.deleteField(id, req.user.id);
  }
}
