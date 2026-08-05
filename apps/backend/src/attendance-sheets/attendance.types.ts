/**
 * One teaching session (séance) of the monthly register.
 *
 * Only the identifier is stored — the session number ("Séance 3") is the index
 * in the array + 1, so adding, removing or reordering sessions never leaves
 * stale numbers behind. Dates are deliberately not tracked: the register is a
 * handwritten sheet, and the teacher fills the columns by hand.
 */
export interface AttendanceSession {
  id: string;
  /** Reserved for future academies that want dated séances. */
  date?: string;
}

/** The frozen student roster snapshot stored on a sheet. */
export interface AttendanceStudent {
  id?: string;
  first_name?: string;
  last_name?: string;
  phone?: string | null;
  parent_phone?: string | null;
}

/** A weekly teaching pattern parsed out of a group's schedule notes. */
export interface WeeklyPattern {
  /** ISO weekday numbers (1 = Monday … 7 = Sunday) covered by the schedule. */
  days: number[];
  /** Free-text description of the schedule, e.g. "Monday 16:00 → 18:00". */
  description: string;
}

/** Everything the register needs to be generated for one month. */
export interface AttendanceContext {
  group_id: string;
  group_name: string;
  professor_id: string | null;
  professor_name: string;
  level_name: string;
  field_name: string | null;
  month: number;
  year: number;
  academic_year: string;
  /** Raw schedule notes, kept for the banner and reprints. */
  schedule: string | null;
  /** The parsed weekly teaching days, used to place sessions. */
  weekly: WeeklyPattern | null;
  students: AttendanceStudent[];
  sessions: AttendanceSession[];
}
