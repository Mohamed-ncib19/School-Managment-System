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

  @Get("fields")
  async fields() {
    return this.hierarchy.fieldSummaries();
  }

  @Get("professors")
  async professors(@Query("fieldId") fieldId?: string) {
    return this.hierarchy.professorSummaries(fieldId);
  }

  @Get("levels")
  async levels(@Query("profId") profId?: string) {
    return this.hierarchy.levelSummaries(profId);
  }

  @Get("groups")
  async groups(@Query("levelId") levelId?: string) {
    return this.hierarchy.groupSummaries(levelId);
  }
}
