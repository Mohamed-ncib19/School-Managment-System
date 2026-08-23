import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { FieldsModule } from "./fields/fields.module";
import { ProfessorsModule } from "./professors/professors.module";
import { LevelsModule } from "./levels/levels.module";
import { GroupsModule } from "./groups/groups.module";
import { StudentsModule } from "./students/students.module";
import { FinancialModule } from "./financial/financial.module";
import { AuditModule } from "./audit/audit.module";
import { ImportsModule } from "./imports/imports.module";
import { BackupModule } from "./backup/backup.module";
import { HierarchyModule } from "./hierarchy/hierarchy.module";
import { HierarchyConfigModule } from "./hierarchy-config/hierarchy-config.module";
import { SystemSettingsModule } from "./system-settings/system-settings.module";
import { AttendanceSheetsModule } from "./attendance-sheets/attendance-sheets.module";
import { UpdatesModule } from "./updates/updates.module";
import { SystemModule } from "./system/system.module";
import { SchedulingModule } from "./scheduling/scheduling.module";
import { WhiteboardsModule } from "./whiteboards/whiteboards.module";
import { DataTransferModule } from "./data-transfer/data-transfer.module";
import { CloudBackupModule } from "./cloud-backup/cloud-backup.module";
import { MachineBindingService } from "./machine/machine-binding.service";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    UsersModule,
    FieldsModule,
    ProfessorsModule,
    LevelsModule,
    GroupsModule,
    StudentsModule,
    FinancialModule,
    AuditModule,
    ImportsModule,
    BackupModule,
    HierarchyModule,
    HierarchyConfigModule,
    SystemSettingsModule,
    AttendanceSheetsModule,
    UpdatesModule,
    SystemModule,
    SchedulingModule,
    WhiteboardsModule,
    DataTransferModule,
    CloudBackupModule,
  ],
  providers: [MachineBindingService],
})
export class AppModule {}
