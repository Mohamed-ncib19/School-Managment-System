import { Module } from "@nestjs/common";
import { HierarchyConfigService } from "./hierarchy-config.service";
import { HierarchyConfigController } from "./hierarchy-config.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [HierarchyConfigController],
  providers: [HierarchyConfigService],
  exports: [HierarchyConfigService],
})
export class HierarchyConfigModule {}
