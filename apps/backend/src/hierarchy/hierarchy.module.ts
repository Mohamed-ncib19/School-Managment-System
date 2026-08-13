import { Module } from "@nestjs/common";
import { HierarchyService } from "./hierarchy.service";
import { HierarchyController } from "./hierarchy.controller";
import { HierarchyDeleteController } from "./hierarchy-delete.controller";
import { HierarchyDeleteService } from "./hierarchy-delete.service";
import { SentinelService } from "./sentinel.service";
import { DbModule } from "../db/db.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [DbModule, AuditModule],
  controllers: [HierarchyController, HierarchyDeleteController],
  providers: [HierarchyService, HierarchyDeleteService, SentinelService],
  exports: [HierarchyService, HierarchyDeleteService, SentinelService],
})
export class HierarchyModule {}
