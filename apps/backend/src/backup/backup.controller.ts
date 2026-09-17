import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { BackupService } from "./backup.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard, Roles } from "../auth/guards/roles.guard";

@ApiTags("backup")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin")
@Controller("backup")
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Post("create")
  @ApiOperation({ summary: "Create a new database backup with a version label" })
  async createBackup(@Body() body: { version?: string }, @Req() req: any) {
    return this.backupService.createBackup(body.version, req.user?.id ?? null);
  }

  @Get()
  @ApiOperation({ summary: "List all available backups with version labels" })
  async listBackups() {
    return this.backupService.listBackups();
  }

  @Post("restore/:id")
  @ApiOperation({ summary: "Restore database from a named backup (replaces current data)" })
  async restoreBackup(
    @Param("id") id: string,
    @Body() body: { confirm?: string },
    @Req() req: any,
  ) {
    if (!id) throw new BadRequestException("L'identifiant de la sauvegarde est requis");
    // The UI makes the operator type a confirmation word; the protocol token
    // proves the caller went through that flow. Without it any authenticated
    // client (or a stale script) could wipe the database with one POST.
    if (body?.confirm !== "RESTORE") {
      throw new BadRequestException("Restauration non confirmée — le jeton de confirmation est requis");
    }
    return this.backupService.restoreBackup(id, req.user?.id ?? null);
  }
}
