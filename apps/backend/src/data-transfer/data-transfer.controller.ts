import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard, Roles } from "../auth/guards/roles.guard";
import { DataTransferService } from "./data-transfer.service";

const FILE_LIMIT = 100 * 1024 * 1024;

@Controller("system/data")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("super_admin")
export class DataTransferController {
  constructor(private readonly dataTransfer: DataTransferService) {}

  @Get("export")
  async export(@Res() res: any) {
    const { buffer, filename } = await this.dataTransfer.exportAll();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post("import/preview")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: FILE_LIMIT } }))
  preview(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("Aucun fichier envoyé.");
    return this.dataTransfer.previewImport(file.buffer, file.originalname);
  }

  @Post("import")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: FILE_LIMIT } }))
  async importData(
    @UploadedFile() file?: Express.Multer.File,
    @Body("fills") fillsJson?: string,
    @Req() req?: any,
  ) {
    if (!file) throw new BadRequestException("Aucun fichier envoyé.");

    let fills: Record<string, Record<string, string>> = {};
    if (fillsJson && fillsJson !== "{}") {
      try {
        fills = JSON.parse(fillsJson);
      } catch {
        throw new BadRequestException("Les valeurs de remplissage envoyées sont invalides.");
      }
    }

    const actor = req?.user;
    if (!actor?.id) throw new BadRequestException("Utilisateur non identifié.");

    return this.dataTransfer.importAll(file.buffer, fills, actor.id);
  }
}