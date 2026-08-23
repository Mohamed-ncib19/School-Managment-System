import {
  Controller,
  Get,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditService } from "./audit.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/guards/roles.guard";

@ApiTags("audit")
@ApiBearerAuth()
@Controller("audit-logs")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin")
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: "Paginated administrative audit trail" })
  async findAll(
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query("entityType") entityType?: string,
    @Query("action") action?: string,
    @Query("actorUserId") actorUserId?: string,
    @Query("search") search?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("sortBy") sortBy?: "created_at" | "action" | "entity_type",
    @Query("sortDir") sortDir?: "asc" | "desc",
  ) {
    return this.auditService.listLogs({
      page: Math.max(1, page),
      limit: Math.min(Math.max(1, limit), 100),
      entityType,
      action,
      actorUserId,
      search,
      from,
      to,
      sortBy,
      sortDir,
    });
  }

  @Get("options")
  @ApiOperation({ summary: "Distinct actions, entity types and actors for the filter controls" })
  async options() {
    return this.auditService.listFilterOptions();
  }

  @Get("summary")
  @ApiOperation({ summary: "Counts per action and a daily series for the audit overview, with the same filters as the list" })
  async summary(
    @Query("entityType") entityType?: string,
    @Query("action") action?: string,
    @Query("actorUserId") actorUserId?: string,
    @Query("search") search?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.auditService.summary({ entityType, action, actorUserId, search, from, to });
  }
}
