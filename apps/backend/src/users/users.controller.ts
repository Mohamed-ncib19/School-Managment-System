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
    const user = await this.usersService.updateProfile(userId, dto);
    await this.auditService.createLog(userId, "user.profile_updated", "user", userId, {
      updated_fields: Object.keys(dto),
    });
    return user;
  }
}
