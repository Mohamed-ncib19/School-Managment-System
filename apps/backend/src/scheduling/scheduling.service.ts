import { Injectable } from "@nestjs/common";
import { Conflict } from "./types";
import { ClassroomService } from "./classrooms/classroom.service";
import { TimeSlotService } from "./time-slots/time-slot.service";
import { ScheduleEntryService } from "./schedule-entries/schedule-entry.service";
import { StudentExceptionService } from "./student-exceptions/student-exception.service";
import { ConflictService } from "./conflicts/conflict.service";
import { GroupScheduleService } from "./group-schedule/group-schedule.service";

@Injectable()
export class SchedulingService {
  constructor(
    private readonly classrooms: ClassroomService,
    private readonly timeSlots: TimeSlotService,
    private readonly entries: ScheduleEntryService,
    private readonly exceptions: StudentExceptionService,
    private readonly conflicts: ConflictService,
    private readonly groupSchedule: GroupScheduleService,
  ) {}

  // Classrooms
  listClassrooms(building?: string, active?: boolean) { return this.classrooms.list(building, active); }
  getClassroom(id: string) { return this.classrooms.get(id); }
  createClassroom(dto: any, userId?: string) { return this.classrooms.create(dto, userId); }
  updateClassroom(id: string, dto: any, userId?: string) { return this.classrooms.update(id, dto, userId); }
  removeClassroom(id: string, userId?: string) { return this.classrooms.remove(id, userId); }

  // Time slots
  listTimeSlots(dayOfWeek?: number) { return this.timeSlots.list(dayOfWeek); }
  createTimeSlot(dto: any, userId?: string) { return this.timeSlots.create(dto, userId); }
  updateTimeSlot(id: string, dto: any, userId?: string) { return this.timeSlots.update(id, dto, userId); }
  reorderTimeSlots(dto: { ids: string[] }, userId?: string) { return this.timeSlots.reorder(dto, userId); }
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

  // Conflicts
  scanAllConflicts() { return this.conflicts.scanAll(); }
  previewConflicts(dto: any) { return this.entries.previewConflicts(dto); }

  // Group tiles
  syncTiles(groupId: string, tiles: any[], profId: string) { return this.groupSchedule.syncTiles(groupId, tiles, profId); }
  removeTile(groupId: string, scheduleEntryId: string) { return this.groupSchedule.removeTile(groupId, scheduleEntryId); }
  getStudentEligibility(studentId: string) { return this.groupSchedule.getStudentEligibility(studentId); }
}
