import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { schedulingApi } from "@/lib/api/scheduling.api";

export const schedulingKeys = {
  all: ["scheduling"] as const,
  classrooms: (building?: string, active?: boolean) =>
    ["scheduling", "classrooms", building ?? "", active ?? ""] as const,
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

export function useClassrooms(building?: string, active?: boolean) {
  return useQuery({
    queryKey: schedulingKeys.classrooms(building, active),
    queryFn: () => schedulingApi.classrooms.list(building, active),
  });
}

export function useTimeSlots(dayOfWeek?: number) {
  return useQuery({
    queryKey: schedulingKeys.timeSlots(dayOfWeek),
    queryFn: () => schedulingApi.timeSlots.list(dayOfWeek),
  });
}

export function useScheduleEntries(filters: Record<string, unknown>) {
  return useQuery({
    queryKey: schedulingKeys.entries(filters),
    queryFn: () => schedulingApi.entries.list(filters),
  });
}

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
