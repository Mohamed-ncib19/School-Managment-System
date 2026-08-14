import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { schedulingApi, type CreateEntryExceptionPayload, type SplitEntryPayload, type WorkingHourWindow } from "@/lib/api/scheduling.api";

export const schedulingKeys = {
  all: ["scheduling"] as const,
  classrooms: (active?: boolean) =>
    ["scheduling", "classrooms", active ?? ""] as const,
  classroom: (id: string) => ["scheduling", "classroom", id] as const,
  timeSlots: (dayOfWeek?: number) =>
    ["scheduling", "time-slots", dayOfWeek ?? ""] as const,
  entries: (filters: Record<string, unknown>) =>
    ["scheduling", "entries", JSON.stringify(filters)] as const,
  studentSchedule: (studentId: string, from: string, to: string) =>
    ["scheduling", "student-schedule", studentId, from, to] as const,
  groupSchedule: (groupId: string, from: string, to: string) =>
    ["scheduling", "group-schedule", groupId, from, to] as const,
  conflicts: () => ["scheduling", "conflicts"] as const,
  multiGroupCheck: (studentId: string) =>
    ["scheduling", "multi-group", studentId] as const,
};

export function useClassrooms(active?: boolean) {
  return useQuery({
    queryKey: schedulingKeys.classrooms(active),
    queryFn: () => schedulingApi.classrooms.list(active),
  });
}

export function useTimeSlots(dayOfWeek?: number) {
  return useQuery({
    queryKey: schedulingKeys.timeSlots(dayOfWeek),
    queryFn: () => schedulingApi.timeSlots.list(dayOfWeek),
  });
}

export function useScheduleEntries(filters: Record<string, unknown>, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: schedulingKeys.entries(filters),
    queryFn: () => schedulingApi.entries.list(filters),
    enabled: options?.enabled ?? true,
  });
}

/**
 * The live timetable, as both the entries page and the group list ask for it.
 *
 * A module constant so the query key is byte-identical from either page: the
 * two used to fetch the same list under keys of their own and pay for it twice
 * when navigating between them.
 */
export const ACTIVE_ENTRIES = { active: true } as const;

export function useStudentSchedule(studentId: string, from: string, to: string) {
  return useQuery({
    queryKey: schedulingKeys.studentSchedule(studentId, from, to),
    queryFn: () => schedulingApi.entries.studentSchedule(studentId, from, to),
    enabled: !!studentId,
  });
}

export function useGroupSchedule(groupId: string, from: string, to: string) {
  return useQuery({
    queryKey: schedulingKeys.groupSchedule(groupId, from, to),
    queryFn: () => schedulingApi.entries.groupSchedule(groupId, from, to),
    enabled: !!groupId,
  });
}

export function useConflicts() {
  return useQuery({
    queryKey: schedulingKeys.conflicts(),
    queryFn: () => schedulingApi.conflicts.scan(),
  });
}

export function useMultiGroupCheck(studentId: string) {
  return useQuery({
    queryKey: schedulingKeys.multiGroupCheck(studentId),
    queryFn: () => schedulingApi.students.multiGroupCheck(studentId),
    enabled: !!studentId,
  });
}

export function useSyncTiles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, tiles }: { groupId: string; tiles: any[] }) =>
      schedulingApi.groupSchedule.syncTiles(groupId, tiles),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduling"] });
    },
  });
}

export function useCreateClassroom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => schedulingApi.classrooms.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: schedulingKeys.all }),
  });
}

export function useCreateTimeSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => schedulingApi.timeSlots.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: schedulingKeys.all }),
  });
}

export function usePreviewConflicts() {
  return useMutation({
    mutationFn: (data: any) => schedulingApi.conflicts.preview(data),
  });
}

export function useOccurrences(params: { from: string; to: string; groupId?: string; profId?: string; classroomId?: string; search?: string }) {
  return useQuery({
    queryKey: ["scheduling", "occurrences", params.from, params.to, params.groupId ?? "", params.profId ?? "", params.classroomId ?? "", params.search ?? ""],
    queryFn: () => schedulingApi.occurrences.list(params),
    enabled: !!params.from && !!params.to,
  });
}

export function useOccurrenceCount(from: string, to: string) {
  return useQuery({
    queryKey: ["scheduling", "occurrences-count", from, to],
    queryFn: () => schedulingApi.occurrences.count(from, to),
    enabled: !!from && !!to,
  });
}

export function useCreateEntryException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, data }: { entryId: string; data: CreateEntryExceptionPayload }) =>
      schedulingApi.entryExceptions.create(entryId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduling"] }),
    onError: () => qc.invalidateQueries({ queryKey: ["scheduling"] }),
  });
}

export function useRemoveEntryException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => schedulingApi.entryExceptions.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduling"] }),
  });
}

export function useSplitEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, data }: { entryId: string; data: SplitEntryPayload }) =>
      schedulingApi.entries.split(entryId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduling"] }),
    onError: () => qc.invalidateQueries({ queryKey: ["scheduling"] }),
  });
}

export function useEndEntrySeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, fromDate }: { entryId: string; fromDate: string }) =>
      schedulingApi.entries.end(entryId, fromDate),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduling"] }),
  });
}

export function useWorkingHours() {
  return useQuery({
    queryKey: ["scheduling", "working-hours"],
    queryFn: () => schedulingApi.workingHours.list(),
  });
}

/**
 * The calendar's visible bounds, derived from the windows already loaded.
 *
 * `/working-hours/bounds` and `/working-hours/empty` are both pure functions of
 * `/working-hours` — the whole table is at most a handful of rows and the
 * settings page was fetching it three times to ask three questions about it.
 * Deriving here keeps the endpoints available for other callers while the page
 * makes one request.
 */
export function useWorkingHoursBounds() {
  const { data, ...rest } = useWorkingHours();
  const bounds = useMemo(() => {
    if (!data || data.length === 0) return null;
    const min = data.reduce((acc, w) => (w.start_time < acc ? w.start_time : acc), "23:59");
    const max = data.reduce((acc, w) => (w.end_time > acc ? w.end_time : acc), "00:00");
    return { min, max };
  }, [data]);
  return { ...rest, data: bounds };
}

export function useWorkingHoursEmpty() {
  const { data, ...rest } = useWorkingHours();
  return { ...rest, data: data ? data.length === 0 : undefined };
}

export function useUpsertWorkingHours() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (windows: WorkingHourWindow[]) => schedulingApi.workingHours.upsert(windows),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduling", "working-hours"] }),
  });
}
