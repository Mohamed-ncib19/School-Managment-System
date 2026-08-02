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
import { FieldsService } from "./fields.service";
import { CreateFieldDto, UpdateFieldDto } from "./dto/field.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/guards/roles.guard";

@Controller("fields")
@UseGuards(JwtAuthGuard, RolesGuard)
export class FieldsController {
  constructor(private readonly fieldsService: FieldsService) {}

  @Get()
  async findAll(@Query("levelId") levelId?: string) {
    return this.fieldsService.listFields(levelId);
  }

  // Declared before @Get(":id"): the literal "deleted" must win over the UUID param.
  @Get("deleted")
  @Roles("super_admin")
  async findDeleted(@Query("levelId") levelId?: string) {
    return this.fieldsService.listDeletedFields(levelId);
  }

  @Get(":id")
  async findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.fieldsService.getField(id);
  }

  @Post()
  @Roles("super_admin")
  async create(@Body() dto: CreateFieldDto, @Req() req: any) {
    return this.fieldsService.createField({ ...dto, created_by: req.user.id });
  }

  @Put(":id")
  @Roles("super_admin")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateFieldDto,
    @Req() req: any,
  ) {
    return this.fieldsService.updateField(id, dto, req.user.id);
  }

  @Delete(":id")
  @Roles("super_admin")
  async remove(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.fieldsService.deleteField(id, req.user.id);
  }

  @Post(":id/restore")
  @Roles("super_admin")
  async restore(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.fieldsService.restoreField(id, req.user.id);
  }

  @Delete(":id/hard")
  @Roles("super_admin")
  @ApiOperation({ summary: "Permanently delete an archived field and everything beneath it" })
  async hardDelete(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.fieldsService.hardDeleteField(id, req.user.id);
  }
}
