import {
  Controller,
  Get,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from "@nestjs/common";
import { AuditService } from "./audit.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/guards/roles.guard";

@Controller("audit-logs")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin")
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async findAll(
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query("entityType") entityType?: string,
    @Query("action") action?: string,
    @Query("actorUserId") actorUserId?: string,
  ) {
    return this.auditService.listLogs({
      page,
      limit: Math.min(limit, 100),
      entityType,
      action,
      actorUserId,
    });
  }
}
