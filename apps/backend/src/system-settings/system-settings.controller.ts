import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard, Roles } from "../auth/guards/roles.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { SystemSettingsService } from "./system-settings.service";
import { UpdateSystemSettingsDto } from "./dto/system-settings.dto";

/**
 * System-wide configuration.
 *
 * The GET route is deliberately public: the browser tab title and the login
 * screen render before any token exists, and the payload (a display name and
 * module toggles) contains nothing secret. Updates stay `super_admin` only,
 * like the rest of the settings surface.
 */
@Controller("system-settings")
export class SystemSettingsController {
  constructor(private readonly settings: SystemSettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Put()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("super_admin")
  update(@Body() dto: UpdateSystemSettingsDto, @CurrentUser("id") userId: string) {
    return this.settings.update(dto, userId);
  }
}
