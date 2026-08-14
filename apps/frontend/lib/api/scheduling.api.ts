import { ApiClient } from "./client";
import type {
  Classroom,
  TimeSlot,
  ScheduleEntry,
  StudentScheduleException,
  ScheduleEntryException,
  Occurrence,
  Conflict,
  TileDto,
  MultiGroupCheck,
} from "@/types";

export type CreateEntryExceptionPayload = {
  exception_type: "cancelled" | "moved" | "substitute_prof" | "room_change";
  occurrence_date: string;
  new_date?: string;
  /** The new window, typed. The weekday comes from `new_date`. */
  new_start_time?: string;
  new_end_time?: string;
  /** Legacy alternative to the two times above. */
  new_time_slot_id?: string;
  new_classroom_id?: string;
  new_prof_id?: string;
  notes?: string;
};

export type SplitEntryPayload = {
  from_date: string;
  /** The new window, typed. Omit both to keep the rule's current one. */
  day_of_week?: number;
  start_time?: string;
  end_time?: string;
  /** Legacy alternative to the two times above. */
  time_slot_id?: string;
  classroom_id?: string | null;
  prof_id?: string;
  subject?: string;
  notes?: string;
  effective_until?: string | null;
};

export type WorkingHourWindow = {
  day_of_week: number | null;
  label?: string | null;
  start_time: string;
  end_time: string;
  is_active?: boolean;
};

/** One room's answer to "is it free?" for a concrete date and window. */
export type ClassroomAvailability = {
  id: string;
  name: string;
  room_number: string | null;
  capacity: number | null;
  color: string | null;
  available: boolean;
  conflicts: Array<{ scheduleEntryId: string; groupName: string; start_time: string; end_time: string }>;
};

export const schedulingApi = {
  classrooms: {
    list: (active?: boolean) =>
      ApiClient.get<Classroom[]>("/scheduling/classrooms", {
        params: active !== undefined ? { active: active ? "true" : "false" } : {} }),
    get: (id: string) => ApiClient.get<Classroom>(`/scheduling/classrooms/${id}`),
    create: (data: { name: string; floor?: string; room_number?: string; capacity?: number; equipment?: string[]; color?: string }) =>
      ApiClient.post<Classroom>("/scheduling/classrooms", data),
    /** `color: null` clears it; omitting the key leaves it unchanged. */
    update: (id: string, data: Partial<{ name: string; floor: string; room_number: string; capacity: number; equipment: string[]; color: string | null }>) =>
      ApiClient.put<Classroom>(`/scheduling/classrooms/${id}`, data),
    /** Permanent. The API refuses with 409 when sessions still reference the room. */
    remove: (id: string) => ApiClient.del(`/scheduling/classrooms/${id}`),
    availability: (params: {
      date: string;
      start_time: string;
      end_time: string;
      excludeGroupId?: string;
      excludeEntryId?: string;
    }) => ApiClient.get<ClassroomAvailability[]>("/scheduling/classrooms/availability", { params }),
  },

  timeSlots: {
    list: (dayOfWeek?: number) =>
      ApiClient.get<TimeSlot[]>("/scheduling/time-slots", {
        params: dayOfWeek !== undefined ? { dayOfWeek } : {},
      }),
    create: (data: { label: string; day_of_week: number; start_time: string; end_time: string; sort_order?: number }) =>
      ApiClient.post<TimeSlot>("/scheduling/time-slots", data),
    update: (id: string, data: Partial<{ label: string; day_of_week: number; start_time: string; end_time: string; sort_order: number }>) =>
      ApiClient.put<TimeSlot>(`/scheduling/time-slots/${id}`, data),
    reorder: (ids: string[]) => ApiClient.post<void>("/scheduling/time-slots/reorder", { ids }),
    remove: (id: string) => ApiClient.del(`/scheduling/time-slots/${id}`),
  },

  entries: {
    list: (filters: { groupId?: string; profId?: string; classroomId?: string; timeSlotId?: string; date?: string; active?: boolean }) =>
      ApiClient.get<ScheduleEntry[]>("/scheduling/entries", { params: filters }),
    get: (id: string) => ApiClient.get<ScheduleEntry>(`/scheduling/entries/${id}`),
    /**
     * `day_of_week` + the two times, or a legacy `time_slot_id`.
     *
     * `effective_from` is optional and defaults to today server-side; a new
     * rule is always open-ended. Ending a series is `entries.end`.
     */
    create: (data: { group_id: string; day_of_week?: number; start_time?: string; end_time?: string; time_slot_id?: string; classroom_id?: string | null; prof_id: string; subject?: string; notes?: string; effective_from?: string }) =>
      ApiClient.post<{ entry: ScheduleEntry; conflicts: Conflict[]; warnings: string[] }>("/scheduling/entries", data),
    update: (id: string, data: { classroom_id?: string | null; subject?: string; notes?: string; effective_until?: string | null }) =>
      ApiClient.put<ScheduleEntry>(`/scheduling/entries/${id}`, data),
    archive: (id: string) => ApiClient.patch<void>(`/scheduling/entries/${id}/archive`),
    remove: (id: string) => ApiClient.del(`/scheduling/entries/${id}`),
    split: (id: string, data: SplitEntryPayload) =>
      ApiClient.post<{ entry: ScheduleEntry; conflicts: Conflict[]; warnings: string[]; split: boolean }>(`/scheduling/entries/${id}/split`, data),
    end: (id: string, fromDate: string) =>
      ApiClient.post<{ ended: boolean; effective_until: string | null }>(`/scheduling/entries/${id}/end`, { from_date: fromDate }),
    studentSchedule: (studentId: string, from: string, to: string) =>
      ApiClient.get<ScheduleEntry[]>(`/scheduling/students/${studentId}/schedule`, { params: { from, to } }),
    groupSchedule: (groupId: string, from: string, to: string) =>
      ApiClient.get<ScheduleEntry[]>(`/scheduling/groups/${groupId}/schedule`, { params: { from, to } }),
    professorSchedule: (profId: string, from: string, to: string) =>
      ApiClient.get<ScheduleEntry[]>(`/scheduling/professors/${profId}/schedule`, { params: { from, to } }),
    classroomSchedule: (classroomId: string, from: string, to: string) =>
      ApiClient.get<ScheduleEntry[]>(`/scheduling/classrooms/${classroomId}/schedule`, { params: { from, to } }),
  },

  entryExceptions: {
    create: (entryId: string, data: CreateEntryExceptionPayload) =>
      ApiClient.post<ScheduleEntryException>(`/scheduling/entries/${entryId}/exceptions`, data),
    list: (entryId: string, params?: { from?: string; to?: string }) =>
      ApiClient.get<ScheduleEntryException[]>(`/scheduling/entries/${entryId}/exceptions`, { params }),
    remove: (id: string) => ApiClient.del(`/scheduling/entries/exceptions/${id}`),
  },

  occurrences: {
    list: (params: { from: string; to: string; groupId?: string; profId?: string; classroomId?: string; fieldId?: string; levelId?: string; studentId?: string; search?: string }) =>
      ApiClient.get<Occurrence[]>("/scheduling/occurrences", { params }),
    count: (from: string, to: string) =>
      ApiClient.get<number>("/scheduling/occurrences/count", { params: { from, to } }),
  },

  workingHours: {
    list: () => ApiClient.get<WorkingHourWindow[]>("/scheduling/working-hours"),
    bounds: () => ApiClient.get<{ min: string; max: string } | null>("/scheduling/working-hours/bounds"),
    isEmpty: () => ApiClient.get<boolean>("/scheduling/working-hours/empty"),
    upsert: (windows: WorkingHourWindow[]) => ApiClient.put<WorkingHourWindow[]>("/scheduling/working-hours", { windows }),
  },

  exceptions: {
    create: (studentId: string, data: { schedule_entry_id: string; exception_type: "substitute" | "cancelled" | "makeup"; exception_date: string; notes?: string }) =>
      ApiClient.post<StudentScheduleException>(`/scheduling/students/${studentId}/exceptions`, data),
    remove: (id: string) => ApiClient.del(`/scheduling/exceptions/${id}`),
  },

  conflicts: {
    scan: () => ApiClient.get<Conflict[]>("/scheduling/conflicts"),
    preview: (data: { day_of_week: number; start_time: string; end_time: string; prof_id: string; classroom_id?: string | null; time_slot_id?: string; exclude_group_id?: string }) =>
      ApiClient.post<Conflict[]>("/scheduling/conflicts/preview", data),
  },

  groupSchedule: {
    syncTiles: (groupId: string, tiles: TileDto[]) =>
      ApiClient.post<{ created: ScheduleEntry[]; conflicts: Conflict[] }>(`/scheduling/groups/${groupId}/schedule/tiles`, { tiles }),
    removeTile: (groupId: string, scheduleEntryId: string) =>
      ApiClient.del(`/scheduling/groups/${groupId}/schedule/tiles/${scheduleEntryId}`),
  },

  students: {
    multiGroupCheck: (studentId: string) =>
      ApiClient.get<MultiGroupCheck>(`/scheduling/students/${studentId}/multi-group-check`),
  },
};

/**
 * Opens a student's weekly timetable in a new tab and raises the print dialogue.
 *
 * The tab is opened inside the click gesture, before any await, so the popup
 * blocker still sees a trusted gesture — on stricter browsers an `await` in
 * between costs the transient activation and nothing opens. The document is
 * fetched through the authenticated client because the endpoint sits behind the
 * JWT guard and a plain `window.open` would carry no session.
 */
export async function openStudentTimetable(studentId: string): Promise<void> {
  const tab = window.open("", "_blank");
  if (!tab) throw new Error("popup-blocked");
  tab.document.write(
    "<!DOCTYPE html><html><body style='font-family:sans-serif;color:#666;padding:40px'>Chargement de l'emploi du temps…</body></html>",
  );

  try {
    const html = await ApiClient.get<string>(
      `/scheduling/students/${studentId}/timetable/print`,
      { responseType: "text" },
    );
    tab.document.open();
    tab.document.write(html);
    tab.document.close();
  } catch (err) {
    tab.document.open();
    tab.document.write(
      "<!DOCTYPE html><html><body style='font-family:sans-serif;color:#b00;padding:40px'>Impossible de charger l'emploi du temps.</body></html>",
    );
    tab.document.close();
    throw err;
  }
}
