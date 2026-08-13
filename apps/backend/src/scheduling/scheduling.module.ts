import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { AuditModule } from "../audit/audit.module";
import { SchedulingService } from "./scheduling.service";
import { SchedulingController } from "./scheduling.controller";
import { ClassroomService } from "./classrooms/classroom.service";
import { ClassroomRepository } from "./classrooms/classroom.repository";
import { TimeSlotService } from "./time-slots/time-slot.service";
import { ScheduleEntryService } from "./schedule-entries/schedule-entry.service";
import { EntryExceptionService } from "./entry-exceptions/entry-exception.service";
import { OccurrenceService } from "./occurrences/occurrence.service";
import { StudentExceptionService } from "./student-exceptions/student-exception.service";
import { ConflictService } from "./conflicts/conflict.service";
import { GroupScheduleService } from "./group-schedule/group-schedule.service";
import { WorkingHoursService } from "./working-hours/working-hours.service";
import { StudentTimetablePrintService } from "./student-timetable-print.service";
import { FinancialModule } from "../financial/financial.module";

@Module({
  imports: [DbModule, AuditModule, FinancialModule],
  providers: [
    SchedulingService,
    StudentTimetablePrintService,
    ClassroomService,
    ClassroomRepository,
    TimeSlotService,
    ScheduleEntryService,
    EntryExceptionService,
    OccurrenceService,
    StudentExceptionService,
    ConflictService,
    GroupScheduleService,
    WorkingHoursService,
  ],
  controllers: [SchedulingController],
  exports: [SchedulingService, GroupScheduleService],
})
export class SchedulingModule {}
