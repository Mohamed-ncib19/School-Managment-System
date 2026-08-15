import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { AuditModule } from "../audit/audit.module";
import { WhiteboardsController } from "./whiteboards.controller";
import { WhiteboardsService } from "./whiteboards.service";

@Module({
  imports: [DbModule, AuditModule],
  controllers: [WhiteboardsController],
  providers: [WhiteboardsService],
  exports: [WhiteboardsService],
})
export class WhiteboardsModule {}