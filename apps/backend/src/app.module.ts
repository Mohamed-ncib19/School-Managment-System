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
import { PaymentsModule } from "./payments/payments.module";
import { AuditModule } from "./audit/audit.module";
import { ImportsModule } from "./imports/imports.module";
import { BackupModule } from "./backup/backup.module";

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
    PaymentsModule,
    AuditModule,
    ImportsModule,
    BackupModule,
  ],
})
export class AppModule {}
