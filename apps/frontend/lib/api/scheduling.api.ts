import { ApiClient } from "./client";
import type {
  Classroom,
  TimeSlot,
  ScheduleEntry,
  StudentScheduleException,
  Conflict,
  TileDto,
  MultiGroupCheck,
} from "@/types";

export const schedulingApi = {
  classrooms: {
    list: (building?: string, active?: boolean) =>
      ApiClient.get<Classroom[]>("/scheduling/classrooms", {
        params: { ...(building ? { building } : {}), ...(active !== undefined ? { active: active ? "true" : "false" } : {}) },
      }),
    get: (id: string) => ApiClient.get<Classroom>(`/scheduling/classrooms/${id}`),
    create: (data: { name: string; building?: string; floor?: string; room_number?: string; capacity?: number; equipment?: string[]; color?: string }) =>
      ApiClient.post<Classroom>("/scheduling/classrooms", data),
    update: (id: string, data: Partial<{ name: string; building: string; floor: string; room_number: string; capacity: number; equipment: string[]; is_active: boolean; color: string }>) =>
      ApiClient.put<Classroom>(`/scheduling/classrooms/${id}`, data),
    remove: (id: string) => ApiClient.del(`/scheduling/classrooms/${id}`),
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
    create: (data: { group_id: string; time_slot_id: string; classroom_id?: string | null; prof_id: string; subject?: string; notes?: string; effective_from: string; effective_until?: string | null }) =>
      ApiClient.post<ScheduleEntry>("/scheduling/entries", data),
    update: (id: string, data: { classroom_id?: string | null; subject?: string; notes?: string; effective_until?: string | null }) =>
      ApiClient.put<ScheduleEntry>(`/scheduling/entries/${id}`, data),
    archive: (id: string) => ApiClient.patch<void>(`/scheduling/entries/${id}/archive`),
    remove: (id: string) => ApiClient.del(`/scheduling/entries/${id}`),
    studentSchedule: (studentId: string, from: string, to: string) =>
      ApiClient.get<ScheduleEntry[]>(`/scheduling/students/${studentId}/schedule`, { params: { from, to } }),
    groupSchedule: (groupId: string, from: string, to: string) =>
      ApiClient.get<ScheduleEntry[]>(`/scheduling/groups/${groupId}/schedule`, { params: { from, to } }),
    professorSchedule: (profId: string, from: string, to: string) =>
      ApiClient.get<ScheduleEntry[]>(`/scheduling/professors/${profId}/schedule`, { params: { from, to } }),
    classroomSchedule: (classroomId: string, from: string, to: string) =>
      ApiClient.get<ScheduleEntry[]>(`/scheduling/classrooms/${classroomId}/schedule`, { params: { from, to } }),
  },

  exceptions: {
    create: (studentId: string, data: { schedule_entry_id: string; exception_type: "substitute" | "cancelled" | "makeup"; exception_date: string; notes?: string }) =>
      ApiClient.post<StudentScheduleException>(`/scheduling/students/${studentId}/exceptions`, data),
    remove: (id: string) => ApiClient.del(`/scheduling/exceptions/${id}`),
  },

  conflicts: {
    scan: () => ApiClient.get<Conflict[]>("/scheduling/conflicts"),
    preview: (data: { day_of_week: number; start_time: string; end_time: string; prof_id: string; classroom_id?: string | null; time_slot_id: string; exclude_group_id?: string }) =>
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
