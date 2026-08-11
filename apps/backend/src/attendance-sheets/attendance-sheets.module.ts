import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { AuditModule } from "../audit/audit.module";
import { AttendanceService } from "./attendance.service";
import { AttendanceGenerationService } from "./attendance-generation.service";
import { AttendancePrintService } from "./attendance-print.service";
import { AttendanceExportService } from "./attendance-export.service";
import { AttendanceSheetsController } from "./attendance-sheets.controller";

@Module({
  imports: [DbModule, AuditModule],
  providers: [
    AttendanceService,
    AttendanceGenerationService,
    AttendancePrintService,
    AttendanceExportService,
  ],
  controllers: [AttendanceSheetsController],
  exports: [AttendanceService],
})
export class AttendanceSheetsModule {}
