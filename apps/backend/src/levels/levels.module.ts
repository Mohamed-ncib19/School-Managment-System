import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { LevelsService } from "./levels.service";
import { LevelsController } from "./levels.controller";

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [LevelsService],
  controllers: [LevelsController],
  exports: [LevelsService],
})
export class LevelsModule {}
