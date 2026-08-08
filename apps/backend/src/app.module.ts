import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
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
import { AiModule } from "./ai/ai.module";
import { UpdatesModule } from "./updates/updates.module";
import { SystemModule } from "./system/system.module";
import { MachineBindingService } from "./machine/machine-binding.service";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
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
    AiModule,
    UpdatesModule,
    SystemModule,
  ],
  providers: [MachineBindingService],
})
export class AppModule {}
