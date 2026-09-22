import { Controller, Get, Param, Post, Body, Req, UseGuards, BadRequestException } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { HierarchyDeleteService } from "./hierarchy-delete.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

type HierarchyNodeType = "level" | "field" | "professor" | "group";

@ApiTags("hierarchy")
@ApiBearerAuth()
@Controller("hierarchy")
@UseGuards(JwtAuthGuard, RolesGuard)
export class HierarchyDeleteController {
  constructor(private readonly deleteService: HierarchyDeleteService) {}

  @Get(":type/:id/delete-impact")
  @ApiOperation({ summary: "Preview blast radius and direct children for a delete action" })
  async impact(@Param("type") type: HierarchyNodeType, @Param("id") id: string) {
    return this.deleteService.deleteImpact(type, id);
  }

  @Post(":type/:id/archive-cascade")
  @ApiOperation({ summary: "Archive a node and all descendants" })
  async archiveCascade(@Param("type") type: HierarchyNodeType, @Param("id") id: string, @Req() req: any) {
    return this.deleteService.archiveCascade(type, id, req.user.id);
  }

  @Post(":type/:id/delete-cascade")
  @ApiOperation({ summary: "Permanently delete a node and all descendants" })
  async deleteCascade(@Param("type") type: HierarchyNodeType, @Param("id") id: string, @Body() body: { confirm: boolean }, @Req() req: any) {
    if (!body.confirm) throw new BadRequestException("confirm=true is required");
    return this.deleteService.deleteCascade(type, id, req.user.id);
  }

  @Post(":type/:id/detach-delete")
  @ApiOperation({ summary: "Reassign direct children then archive the parent" })
  async detachDelete(@Param("type") type: HierarchyNodeType, @Param("id") id: string, @Body() body: { plan: any }, @Req() req: any) {
    return this.deleteService.detachAndDelete(type, id, body.plan, req.user.id);
  }
}
