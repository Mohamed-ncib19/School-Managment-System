import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { AuditModule } from "../audit/audit.module";
import { GroupsService } from "./groups.service";
import { GroupsController } from "./groups.controller";

@Module({
  imports: [DbModule, AuditModule],
  providers: [GroupsService],
  controllers: [GroupsController],
  exports: [GroupsService],
})
export class GroupsModule {}
