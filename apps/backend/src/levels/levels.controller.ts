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
import { ApiOperation } from "@nestjs/swagger";
import { LevelsService } from "./levels.service";
import { CreateLevelDto, UpdateLevelDto } from "./dto/level.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/guards/roles.guard";

@Controller("levels")
@UseGuards(JwtAuthGuard, RolesGuard)
export class LevelsController {
  constructor(private readonly levelsService: LevelsService) {}

  @Get()
  async findAll() {
    return this.levelsService.listLevels();
  }

  // Declared before @Get(":id"): the literal "deleted" must win over the UUID param.
  @Get("deleted")
  @Roles("super_admin")
  async findDeleted() {
    return this.levelsService.listDeletedLevels();
  }

  @Get(":id")
  async findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.levelsService.getLevel(id);
  }

  @Post()
  @Roles("super_admin")
  async create(@Body() dto: CreateLevelDto, @Req() req: any) {
    return this.levelsService.createLevel(dto, req.user.id);
  }

  @Put(":id")
  @Roles("super_admin")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateLevelDto,
    @Req() req: any,
  ) {
    return this.levelsService.updateLevel(id, dto, req.user.id);
  }

  @Delete(":id")
  @Roles("super_admin")
  async remove(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.levelsService.deleteLevel(id, req.user.id);
  }

  @Post(":id/restore")
  @Roles("super_admin")
  async restore(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.levelsService.restoreLevel(id, req.user.id);
  }

  @Delete(":id/hard")
  @Roles("super_admin")
  @ApiOperation({ summary: "Permanently delete an archived level and everything beneath it" })
  async hardDelete(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.levelsService.hardDeleteLevel(id, req.user.id);
  }
}
