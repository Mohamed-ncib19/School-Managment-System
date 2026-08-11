import { Module } from "@nestjs/common";
import { HierarchyConfigService } from "./hierarchy-config.service";
import { HierarchyConfigController } from "./hierarchy-config.controller";
import { DbModule } from "../db/db.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [DbModule, AuditModule],
  controllers: [HierarchyConfigController],
  providers: [HierarchyConfigService],
  exports: [HierarchyConfigService],
})
export class HierarchyConfigModule {}
