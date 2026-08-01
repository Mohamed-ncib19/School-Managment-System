import { Module } from "@nestjs/common";
import { HierarchyController } from "./hierarchy.controller";
import { HierarchyService } from "./hierarchy.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [HierarchyController],
  providers: [HierarchyService],
  exports: [HierarchyService],
})
export class HierarchyModule {}
