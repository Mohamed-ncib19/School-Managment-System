import { Module } from "@nestjs/common";
import { DataTransferController } from "./data-transfer.controller";
import { DataTransferService } from "./data-transfer.service";
import { DbModule } from "../db/db.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [DbModule, AuditModule],
  controllers: [DataTransferController],
  providers: [DataTransferService],
  exports: [DataTransferService],
})
export class DataTransferModule {}