import { Injectable } from "@nestjs/common";
import { ClassroomService } from "./classrooms/classroom.service";
import { TimeSlotService } from "./time-slots/time-slot.service";
import { ScheduleEntryService } from "./schedule-entries/schedule-entry.service";
import { EntryExceptionService } from "./entry-exceptions/entry-exception.service";
import { StudentExceptionService } from "./student-exceptions/student-exception.service";
import { ConflictService } from "./conflicts/conflict.service";
import { GroupScheduleService } from "./group-schedule/group-schedule.service";
import { OccurrenceService } from "./occurrences/occurrence.service";
import { WorkingHoursService } from "./working-hours/working-hours.service";
import { CreateTimeSlotDto, UpdateTimeSlotDto, ReorderTimeSlotsDto } from "./dto/time-slot.dto";

@Injectable()
export class SchedulingService {
  constructor(
    private readonly classrooms: ClassroomService,
    private readonly timeSlots: TimeSlotService,
    private readonly entries: ScheduleEntryService,
    private readonly entryExceptions: EntryExceptionService,
    private readonly exceptions: StudentExceptionService,
    private readonly conflicts: ConflictService,
    private readonly groupSchedule: GroupScheduleService,
    private readonly occurrences: OccurrenceService,
    private readonly workingHours: WorkingHoursService,
  ) {}

  // Classrooms
  listClassrooms(active?: boolean) { return this.classrooms.list(active); }
  getClassroom(id: string) { return this.classrooms.get(id); }
  createClassroom(dto: any, userId?: string) { return this.classrooms.create(dto, userId); }
  updateClassroom(id: string, dto: any, userId?: string) { return this.classrooms.update(id, dto, userId); }
  removeClassroom(id: string, userId?: string) { return this.classrooms.remove(id, userId); }
  classroomAvailability(query: { date: string; start_time: string; end_time: string; excludeGroupId?: string; excludeEntryId?: string }) {
    return this.classrooms.availability(query);
  }

  // Time slots
  listTimeSlots(dayOfWeek?: number) { return this.timeSlots.list(dayOfWeek); }
  createTimeSlot(dto: CreateTimeSlotDto, userId?: string) { return this.timeSlots.create(dto, userId); }
  updateTimeSlot(id: string, dto: UpdateTimeSlotDto, userId?: string) { return this.timeSlots.update(id, dto, userId); }
  reorderTimeSlots(dto: ReorderTimeSlotsDto, userId?: string) { return this.timeSlots.reorder(dto, userId); }
  removeTimeSlot(id: string, userId?: string) { return this.timeSlots.remove(id, userId); }

  // Schedule entries
  listEntries(filters: any) { return this.entries.list(filters); }
  getEntry(id: string) { return this.entries.get(id); }
  createEntry(dto: any, userId?: string) { return this.entries.create(dto, userId); }
  updateEntry(id: string, dto: any, userId?: string) { return this.entries.update(id, dto, userId); }
  archiveEntry(id: string, userId?: string) { return this.entries.archive(id, userId); }
  removeEntry(id: string, userId?: string) { return this.entries.remove(id, userId); }

  // Derived schedules
  getStudentSchedule(studentId: string, from: string, to: string) { return this.entries.getStudentSchedule(studentId, from, to); }
  getGroupSchedule(groupId: string, from: string, to: string) { return this.entries.getGroupSchedule(groupId, from, to); }
  getProfessorSchedule(profId: string, from: string, to: string) { return this.entries.getProfessorSchedule(profId, from, to); }
  getClassroomSchedule(classroomId: string, from: string, to: string) { return this.entries.getClassroomSchedule(classroomId, from, to); }

  // Exceptions
  createException(studentId: string, dto: any, userId?: string) { return this.exceptions.create(studentId, dto.schedule_entry_id, dto, userId); }
  removeException(id: string, userId?: string) { return this.exceptions.remove(id, userId); }

  // Entry exceptions — one-off overrides on recurring rules
  createEntryException(entryId: string, dto: any, userId?: string) { return this.entryExceptions.create(entryId, dto, userId); }
  listEntryExceptions(filters: any) { return this.entryExceptions.list(filters); }
  removeEntryException(id: string, userId?: string) { return this.entryExceptions.remove(id, userId); }

  // Series editing — "this and following"
  splitEntry(entryId: string, dto: any, userId?: string) { return this.entries.splitAndUpdate(entryId, dto.from_date, dto, userId); }
  endEntrySeries(entryId: string, fromDate: string, userId?: string) { return this.entries.endSeries(entryId, fromDate, userId); }

  // Occurrences — expanded concrete sessions for the calendar
  listOccurrences(filters: any, from: string, to: string) { return this.occurrences.generateOccurrences(filters, from, to); }
  countOccurrences(from: string, to: string) { return this.occurrences.countOccurrences(from, to); }

  // Working hours
  listWorkingHours() { return this.workingHours.list(); }
  workingHoursBounds() { return this.workingHours.bounds(); }
  workingHoursEmpty() { return this.workingHours.isEmpty(); }
  upsertWorkingHours(dto: any, userId?: string) { return this.workingHours.upsert(dto, userId); }

  // Conflicts
  scanAllConflicts() { return this.conflicts.scanAll(); }
  previewConflicts(dto: any) { return this.entries.previewConflicts(dto); }

  // Group tiles
  syncTiles(groupId: string, tiles: any[], profId: string) { return this.groupSchedule.syncTiles(groupId, tiles, profId); }
  removeTile(groupId: string, scheduleEntryId: string) { return this.groupSchedule.removeTile(groupId, scheduleEntryId); }
  getStudentEligibility(studentId: string) { return this.groupSchedule.getStudentEligibility(studentId); }
}
