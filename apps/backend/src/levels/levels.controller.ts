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
import { LevelsService } from "./levels.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/guards/roles.guard";

@Controller("levels")
@UseGuards(JwtAuthGuard, RolesGuard)
export class LevelsController {
  constructor(private readonly levelsService: LevelsService) {}

  @Get()
  async findAll(@Query("profId") profId?: string) {
    return this.levelsService.listLevels(profId);
  }

  @Get(":id")
  async findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.levelsService.getLevel(id);
  }

  @Post()
  @Roles("super_admin")
  async create(@Body() dto: { prof_id: string; name: string }, @Req() req: any) {
    return this.levelsService.createLevel(dto, req.user.id);
  }

  @Put(":id")
  @Roles("super_admin")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: { name?: string },
    @Req() req: any,
  ) {
    return this.levelsService.updateLevel(id, dto, req.user.id);
  }

  @Delete(":id")
  @Roles("super_admin")
  async remove(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.levelsService.deleteLevel(id, req.user.id);
  }
}
