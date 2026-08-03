import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { AttendanceSheetsService } from "./attendance-sheets.service";
import { AttendanceSheetsController } from "./attendance-sheets.controller";

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [AttendanceSheetsService],
  controllers: [AttendanceSheetsController],
  exports: [AttendanceSheetsService],
})
export class AttendanceSheetsModule {}