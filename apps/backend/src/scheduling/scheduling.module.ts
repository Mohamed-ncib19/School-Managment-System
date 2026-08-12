import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { AuditModule } from "../audit/audit.module";
import { SchedulingService } from "./scheduling.service";
import { SchedulingController } from "./scheduling.controller";
import { ClassroomService } from "./classrooms/classroom.service";
import { ClassroomRepository } from "./classrooms/classroom.repository";
import { TimeSlotService } from "./time-slots/time-slot.service";
import { ScheduleEntryService } from "./schedule-entries/schedule-entry.service";
import { StudentExceptionService } from "./student-exceptions/student-exception.service";
import { ConflictService } from "./conflicts/conflict.service";
import { GroupScheduleService } from "./group-schedule/group-schedule.service";

@Module({
  imports: [DbModule, AuditModule],
  providers: [
    SchedulingService,
    ClassroomService,
    ClassroomRepository,
    TimeSlotService,
    ScheduleEntryService,
    StudentExceptionService,
    ConflictService,
    GroupScheduleService,
  ],
  controllers: [SchedulingController],
  exports: [SchedulingService, GroupScheduleService],
})
export class SchedulingModule {}
