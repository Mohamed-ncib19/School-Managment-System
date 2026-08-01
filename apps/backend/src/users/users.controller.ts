import {
  Controller,
  Get,
  Patch,
  UseGuards,
  Request,
  Body,
} from "@nestjs/common";
import { UsersService } from "./users.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AuditService } from "../audit/audit.service";
import { changedFields } from "../audit/audit.util";

@Controller("users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  @Get("me")
  async getMe(@Request() req: any) {
    return this.usersService.me(req.user.id);
  }

  @Patch("me")
  async updateMe(@Request() req: any, @Body() dto: { full_name?: string; email?: string }) {
    const userId = req.user.id;
    const before = await this.usersService.me(userId);
    const user = await this.usersService.updateProfile(userId, dto);

    const { prevValues, newValues, changed } = changedFields(before, dto);
    await this.auditService.record({
      action: "user.profile_updated",
      entityType: "user",
      entityId: userId,
      entityLabel: user.full_name,
      actorId: userId,
      prevValues,
      newValues,
      meta: { changed_fields: changed },
    });
    return user;
  }
}
