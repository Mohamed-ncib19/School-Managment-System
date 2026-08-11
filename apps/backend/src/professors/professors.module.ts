import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { AuditModule } from "../audit/audit.module";
import { ProfessorsService } from "./professors.service";
import { ProfessorsController } from "./professors.controller";

@Module({
  imports: [DbModule, AuditModule],
  providers: [ProfessorsService],
  controllers: [ProfessorsController],
  exports: [ProfessorsService],
})
export class ProfessorsModule {}
