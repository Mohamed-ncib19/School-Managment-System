import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { HierarchyService } from "./hierarchy.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

@ApiTags("hierarchy")
@ApiBearerAuth()
@Controller("hierarchy")
@UseGuards(JwtAuthGuard, RolesGuard)
export class HierarchyController {
  constructor(private readonly hierarchy: HierarchyService) {}

  @Get("summary")
  @ApiOperation({ summary: "Counts for every hierarchy level, aggregated in SQL" })
  async summary() {
    return this.hierarchy.fullSummary();
  }

  @Get("levels")
  async levels() {
    return this.hierarchy.levelSummaries();
  }

  @Get("fields")
  async fields(@Query("levelId") levelId?: string) {
    return this.hierarchy.fieldSummaries(levelId);
  }

  @Get("professors")
  async professors(@Query("fieldId") fieldId?: string) {
    return this.hierarchy.professorSummaries(fieldId);
  }

  @Get("groups")
  async groups(@Query("profId") profId?: string) {
    return this.hierarchy.groupSummaries(profId);
  }

  @Get("resolve")
  @ApiOperation({ summary: "Resolve a hierarchy path and return breadcrumbs + children" })
  async resolve(@Query("segments") segmentsJson: string) {
    const segments = JSON.parse(segmentsJson || "[]");
    return this.hierarchy.resolvePath(segments);
  }
}
