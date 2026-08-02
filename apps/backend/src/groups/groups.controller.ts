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
import { GroupsService } from "./groups.service";
import { CreateGroupDto, UpdateGroupDto } from "./dto/group.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/guards/roles.guard";

@Controller("groups")
@UseGuards(JwtAuthGuard, RolesGuard)
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  async findAll(@Query("profId") profId?: string) {
    return this.groupsService.listGroups(profId);
  }

  // Declared before @Get(":id"): the literal "deleted" must win over the UUID param.
  @Get("deleted")
  @Roles("super_admin")
  async findDeleted(@Query("profId") profId?: string) {
    return this.groupsService.listDeletedGroups(profId);
  }

  @Get(":id")
  async findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.groupsService.getGroup(id);
  }

  @Post()
  @Roles("super_admin")
  async create(@Body() dto: CreateGroupDto, @Req() req: any) {
    return this.groupsService.createGroup(dto, req.user.id);
  }

  @Put(":id")
  @Roles("super_admin")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateGroupDto,
    @Req() req: any,
  ) {
    return this.groupsService.updateGroup(id, dto, req.user.id);
  }

  @Delete(":id")
  @Roles("super_admin")
  async remove(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.groupsService.deleteGroup(id, req.user.id);
  }

  @Post(":id/restore")
  @Roles("super_admin")
  async restore(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.groupsService.restoreGroup(id, req.user.id);
  }

  @Delete(":id/hard")
  @Roles("super_admin")
  @ApiOperation({ summary: "Permanently delete an archived group and its students" })
  async hardDelete(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.groupsService.hardDeleteGroup(id, req.user.id);
  }
}
