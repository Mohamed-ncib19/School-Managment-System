export interface Classroom {
  id: string;
  name: string;
  building: string | null;
  floor: string | null;
  room_number: string | null;
  capacity: number | null;
  equipment: string[] | null;
  is_active: boolean;
  color: string | null;
  created_at: string;
  updated_at: string;
  is_system_placeholder?: boolean;
}

export interface TimeSlot {
  id: string;
  label: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  sort_order: number;
  created_at: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  color: string | null;
  field: { id: string; name: string; color: string | null } | null;
}

export interface ProfessorSummary {
  id: string;
  full_name: string;
  color: string | null;
}

export interface ScheduleEntry {
  id: string;
  group_id: string;
  time_slot_id: string;
  classroom_id: string | null;
  prof_id: string;
  subject: string | null;
  notes: string | null;
  effective_from: string;
  effective_until: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  group: GroupSummary;
  time_slot: TimeSlot;
  classroom: Classroom | null;
  professor: ProfessorSummary;
}

export type ScheduleEntryExceptionType = "cancelled" | "moved" | "substitute_prof" | "room_change";

export interface ScheduleEntryException {
  id: string;
  schedule_entry_id: string;
  occurrence_date: string;
  exception_type: ScheduleEntryExceptionType;
  new_date: string | null;
  new_time_slot_id: string | null;
  new_classroom_id: string | null;
  new_prof_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  schedule_entry?: ScheduleEntry;
  new_time_slot?: TimeSlot | null;
  new_classroom?: Classroom | null;
  new_professor?: ProfessorSummary | null;
}

export interface StudentScheduleException {
  id: string;
  student_id: string;
  schedule_entry_id: string;
  exception_type: "substitute" | "cancelled" | "makeup";
  exception_date: string;
  notes: string | null;
  created_at: string;
}

export interface WorkingHour {
  id: string;
  /** 0=Sat … 6=Fri; NULL means "applies to every day unless a specific-day override exists". */
  day_of_week: number | null;
  label: string | null;
  start_time: string;
  end_time: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type OccurrenceStatus =
  | "normal"
  | "cancelled"
  | "moved"
  | "substitute"
  | "room_change"
  | "student_cancelled"
  | "student_substitute"
  | "makeup";

export interface Occurrence {
  /** Derived id `${ruleId}::${date}` — never persisted. */
  occurrenceId: string;
  scheduleEntryId: string;
  date: string;
  start_time: string;
  end_time: string;
  status: OccurrenceStatus;
  /** Set on `moved` occurrences: where the session originally stood. */
  movedFrom?: { date: string; start_time: string } | null;
  subject: string | null;
  notes: string | null;
  group: { id: string; name: string; color: string | null; field: { id: string; name: string; color: string | null } | null };
  classroom: { id: string; name: string; color: string | null; room_number: string | null } | null;
  professor: { id: string; full_name: string; color: string | null };
  /** The whole-class exception that changed this occurrence, when in an exceptional state. */
  exception: ScheduleEntryException | null;
  /** The student-level exception that changed this occurrence (studentId-filtered views only). */
  studentException: StudentScheduleException | null;
  /** Sticky group color used by the calendar for cross-field consistency. */
  color: string | null;
}

export type ConflictType = "professor" | "classroom" | "student";

export interface Conflict {
  type: ConflictType;
  entityId: string;
  entityName: string;
  scheduleEntryId: string;
  timeSlotLabel: string;
  date: string;
}

export interface TileDto {
  day_of_week: number;
  start_time: string;
  end_time: string;
  classroom_id?: string | null;
}

export interface SyncTilesResult {
  created: ScheduleEntry[];
  conflicts: Conflict[];
}