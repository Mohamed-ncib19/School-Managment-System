import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard, Roles } from "../auth/guards/roles.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { WhiteboardsService } from "./whiteboards.service";
import { CreateWhiteboardDto, UpdateWhiteboardDto } from "./dto/whiteboards.dto";

@Controller("whiteboards")
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhiteboardsController {
  constructor(private readonly whiteboardsService: WhiteboardsService) {}

  /**
   * History, metadata only (the scene is fetched with the board itself).
   */
  @Get()
  findAll(@CurrentUser() user: { id: string }) {
    return this.whiteboardsService.list(user.id);
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.whiteboardsService.findOne(user.id, id);
  }

  @Post()
  @Roles("super_admin")
  create(@Body() dto: CreateWhiteboardDto, @CurrentUser() user: { id: string }) {
    return this.whiteboardsService.create(user.id, dto);
  }

  @Put(":id")
  @Roles("super_admin")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateWhiteboardDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.whiteboardsService.update(user.id, id, dto);
  }

  @Delete(":id")
  @Roles("super_admin")
  remove(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: { id: string }) {
    return this.whiteboardsService.remove(user.id, id);
  }
}