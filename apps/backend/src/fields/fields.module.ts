import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { AuditModule } from "../audit/audit.module";
import { HierarchyModule } from "../hierarchy/hierarchy.module";
import { FieldsService } from "./fields.service";
import { FieldsController } from "./fields.controller";

@Module({
  imports: [DbModule, AuditModule, HierarchyModule],
  providers: [FieldsService],
  controllers: [FieldsController],
  exports: [FieldsService],
})
export class FieldsModule {}
