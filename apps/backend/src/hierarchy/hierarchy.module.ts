import { Module } from "@nestjs/common";
import { HierarchyService } from "./hierarchy.service";
import { HierarchyController } from "./hierarchy.controller";
import { HierarchyDeleteController } from "./hierarchy-delete.controller";
import { HierarchyDeleteService } from "./hierarchy-delete.service";
import { DbModule } from "../db/db.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [DbModule, AuditModule],
  controllers: [HierarchyController, HierarchyDeleteController],
  providers: [HierarchyService, HierarchyDeleteService],
  exports: [HierarchyService, HierarchyDeleteService],
})
export class HierarchyModule {}
