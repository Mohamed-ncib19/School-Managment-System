import { Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard, Roles } from "../auth/guards/roles.guard";
import { SystemService } from "./system.service";

/**
 * POST /api/system/stop — super_admin only. Shuts the whole system down,
 * exactly like the old stop.bat: API + web portal, then the portable
 * database on Windows. The response is returned before the engine kills:
 * the engine is a detached process that survives this one.
 */
@Controller("system")
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Post("stop")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("super_admin")
  async stop(): Promise<{ ok: boolean; started: boolean }> {
    return this.system.shutdown();
  }
}