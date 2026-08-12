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

export interface StudentScheduleException {
  id: string;
  student_id: string;
  schedule_entry_id: string;
  exception_type: "substitute" | "cancelled" | "makeup";
  exception_date: string;
  notes: string | null;
  created_at: string;
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
