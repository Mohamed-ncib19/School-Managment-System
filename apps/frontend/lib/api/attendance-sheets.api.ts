import { ApiClient } from "./client";
import type { AttendanceSheet } from "@/types";

export const attendanceSheetsApi = {
  listForGroup: (groupId: string) =>
    ApiClient.get<AttendanceSheet[]>("/attendance-sheets", { params: { groupId } }),
  get: (id: string) => ApiClient.get<AttendanceSheet>(`/attendance-sheets/${id}`),
  save: (data: {
    group_id: string;
    month: number;
    year: number;
    schedule?: string;
    teacher_id?: string;
    teacher_name: string;
    level_name: string;
    group_name: string;
    students: unknown[];
  }) => ApiClient.post<AttendanceSheet>("/attendance-sheets", data),
  remove: (id: string) => ApiClient.del(`/attendance-sheets/${id}`),
};
