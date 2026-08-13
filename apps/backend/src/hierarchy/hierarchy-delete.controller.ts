import { Controller, Get, Param, Post, Query, Body, Req, UseGuards, BadRequestException } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { HierarchyDeleteService } from "./hierarchy-delete.service";
import { SentinelService } from "./sentinel.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

type HierarchyNodeType = "level" | "field" | "professor" | "group";

@ApiTags("hierarchy")
@ApiBearerAuth()
@Controller("hierarchy")
@UseGuards(JwtAuthGuard, RolesGuard)
export class HierarchyDeleteController {
  constructor(
    private readonly deleteService: HierarchyDeleteService,
    private readonly sentinels: SentinelService,
  ) {}

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
  @ApiOperation({ summary: "Detach direct children then archive/delete the parent" })
  async detachDelete(@Param("type") type: HierarchyNodeType, @Param("id") id: string, @Body() body: { plan: any }, @Req() req: any) {
    return this.deleteService.detachAndDelete(type, id, body.plan, req.user.id);
  }

  @Get("unassigned")
  @ApiOperation({ summary: "List unassigned children under a given parent" })
  async unassigned(@Query("parentId") parentId: string, @Query("parentType") parentType: HierarchyNodeType) {
    switch (parentType) {
      case "level":
        return this.sentinels.getUnassignedFields(parentId);
      case "field":
        return this.sentinels.getUnassignedProfessors(parentId);
      case "professor":
        return this.sentinels.getUnassignedGroups(parentId);
      case "group":
        return this.sentinels.getUnassignedStudents(parentId);
      default:
        return [];
    }
  }
}
