import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { FieldsService } from "./fields.service";
import { FieldsController } from "./fields.controller";

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [FieldsService],
  controllers: [FieldsController],
  exports: [FieldsService],
})
export class FieldsModule {}
