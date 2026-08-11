import { Module } from "@nestjs/common";
import { StudentsService } from "./students.service";
import { StudentsController } from "./students.controller";
import { DbModule } from "../db/db.module";
import { AuditModule } from "../audit/audit.module";
import { FinancialModule } from "../financial/financial.module";

@Module({
  imports: [DbModule, AuditModule, FinancialModule],
  controllers: [StudentsController],
  providers: [StudentsService],
  exports: [StudentsService],
})
export class StudentsModule {}
