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
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { ImportsService } from "./imports.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ParsedRow } from "./import.types";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB — a roster workbook is far smaller

@ApiTags("imports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("imports")
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get("students/template")
  @ApiOperation({ summary: "Download the blank student import workbook" })
  async template(@Res() res: Response) {
    const buffer = await this.imports.buildTemplate();
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="iq-academy-student-import-template.xlsx"',
      "Content-Length": buffer.length.toString(),
    });
    res.end(buffer);
  }

  @Post("students")
  @ApiOperation({ summary: "Append students (and any missing hierarchy) from a workbook" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!/\.xlsx$/i.test(file.originalname)) {
          return cb(new BadRequestException("Only .xlsx workbooks are supported"), false);
        }
        cb(null, true);
      },
    }),
  )
  async importStudents(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException("No file was uploaded");
    return this.imports.importStudents(file.buffer, req.user.id);
  }

  @Post("preview")
  @ApiOperation({ summary: "Parse an Excel file and return rows for review before importing" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!/\.xlsx$/i.test(file.originalname)) {
          return cb(new BadRequestException("Only .xlsx workbooks are supported"), false);
        }
        cb(null, true);
      },
    }),
  )
  async previewStudents(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("No file was uploaded");
    return this.imports.previewStudents(file.buffer);
  }

  @Post("preview/confirm")
  @ApiOperation({ summary: "Import pre-edited rows from the preview step" })
  async confirmPreview(
    @Body() body: { rows: ParsedRow[] },
    @Req() req: any,
  ) {
    if (!body.rows || !Array.isArray(body.rows) || body.rows.length === 0) {
      throw new BadRequestException("No rows to import");
    }
    return this.imports.importStudentsFromRows(body.rows, req.user.id);
  }
}
