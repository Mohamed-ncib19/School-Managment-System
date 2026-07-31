import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { ProfessorsService } from "./professors.service";
import { ProfessorsController } from "./professors.controller";

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [ProfessorsService],
  controllers: [ProfessorsController],
  exports: [ProfessorsService],
})
export class ProfessorsModule {}
