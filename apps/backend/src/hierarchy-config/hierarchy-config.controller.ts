import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/guards/roles.guard";
import { HierarchyConfigService } from "./hierarchy-config.service";
import { CreateHierarchyConfigDto, UpdateHierarchyConfigDto } from "./dto/hierarchy-config.dto";
import { CurrentUser } from "../common/decorators/current-user.decorator";

@Controller("hierarchy-config")
@UseGuards(JwtAuthGuard, RolesGuard)
export class HierarchyConfigController {
  constructor(private readonly hierarchyConfigService: HierarchyConfigService) {}

  @Get()
  findAll() {
    return this.hierarchyConfigService.findAll();
  }

  @Get("active")
  findActive() {
    return this.hierarchyConfigService.findActive();
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.hierarchyConfigService.findOne(id);
  }

  @Post()
  @Roles("super_admin")
  create(@Body() dto: CreateHierarchyConfigDto, @CurrentUser() user: { id: string }) {
    return this.hierarchyConfigService.create(dto, user.id);
  }

  @Patch(":id")
  @Roles("super_admin")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateHierarchyConfigDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.hierarchyConfigService.update(id, dto, user.id);
  }

  @Post(":id/activate")
  @Roles("super_admin")
  activate(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.hierarchyConfigService.activate(id, user.id);
  }

  @Delete(":id")
  @Roles("super_admin")
  remove(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.hierarchyConfigService.remove(id, user.id);
  }

  @Post("reset")
  @Roles("super_admin")
  resetToDefault(@CurrentUser() user: { id: string }) {
    return this.hierarchyConfigService.resetToDefault(user.id);
  }
}
