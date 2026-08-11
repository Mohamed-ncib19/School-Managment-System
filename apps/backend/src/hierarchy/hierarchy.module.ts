import { Module } from "@nestjs/common";
import { HierarchyService } from "./hierarchy.service";
import { HierarchyController } from "./hierarchy.controller";
import { DbModule } from "../db/db.module";

@Module({
  imports: [DbModule],
  controllers: [HierarchyController],
  providers: [HierarchyService],
  exports: [HierarchyService],
})
export class HierarchyModule {}
