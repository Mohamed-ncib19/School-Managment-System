import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { LevelsService } from "./levels.service";
import { LevelsController } from "./levels.controller";

@Module({
  imports: [AuditModule],
  providers: [LevelsService],
  controllers: [LevelsController],
  exports: [LevelsService],
})
export class LevelsModule {}
