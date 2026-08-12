import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { AuditModule } from "../audit/audit.module";
import { SchedulingModule } from "../scheduling/scheduling.module";
import { GroupsService } from "./groups.service";
import { GroupsController } from "./groups.controller";

@Module({
  imports: [DbModule, AuditModule, SchedulingModule],
  providers: [GroupsService],
  controllers: [GroupsController],
  exports: [GroupsService],
})
export class GroupsModule {}
