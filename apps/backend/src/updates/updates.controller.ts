import { Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard, Roles } from "../auth/guards/roles.guard";
import { UpdatesService, UpdateStatus, UpdateProgress } from "./updates.service";

/**
 * GET /api/updates        — is the installed commit behind the GitHub repo?
 *                           Public and cheap to serve over the LAN; nothing
 *                           sensitive is revealed (commit ids only).
 *                           ?refresh=1 bypasses the in-memory cache so the
 *                           operator's "check now" button always hits GitHub.
 * GET /api/updates/progress — live state of the update engine's progress
 *                           journal (public: step labels only).
 * POST /api/updates/apply — super_admin only. Spawns the platform's update
 *                           engine (tools\windows\scripts\do-update.ps1 or
 *                           tools/macos/scripts/update.sh) as a separate
 *                           process so the operator watches it do the work.
 */
@Controller("updates")
export class UpdatesController {
  constructor(private readonly updates: UpdatesService) {}

  @Get()
  check(@Query("refresh") refresh?: string): Promise<UpdateStatus> {
    return this.updates.getStatus(refresh === "1" || refresh === "true");
  }

  @Get("progress")
  progress(): Promise<UpdateProgress> {
    return this.updates.getProgress();
  }

  @Post("apply")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("super_admin")
  async apply(): Promise<{ ok: boolean; started: boolean }> {
    return this.updates.applyUpdate();
  }
}