import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { BackupService } from "./backup.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("backup")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("backup")
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Post("create")
  @ApiOperation({ summary: "Create a new database backup with a version label" })
  async createBackup(@Body() body: { version?: string }) {
    return this.backupService.createBackup(body.version);
  }

  @Get()
  @ApiOperation({ summary: "List all available backups with version labels" })
  async listBackups() {
    return this.backupService.listBackups();
  }

  @Post("restore/:id")
  @ApiOperation({ summary: "Restore database from a named backup (replaces current data)" })
  async restoreBackup(@Param("id") id: string) {
    if (!id) throw new BadRequestException("Backup ID is required");
    return this.backupService.restoreBackup(id);
  }
}
