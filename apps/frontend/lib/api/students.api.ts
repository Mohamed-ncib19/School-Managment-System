import { ApiClient } from "./client";
import type { Student, StudentPayment } from "@/types";

export const studentsApi = {
  list: (groupId?: string, search?: string) =>
    ApiClient.get<Student[]>("/students", {
      params: { ...(groupId ? { groupId } : {}), ...(search ? { search } : {}) },
    }),
  get: (id: string) => ApiClient.get<Student>(`/students/${id}`),
  create: (data: any) => ApiClient.post<Student>("/students", data),
  update: (id: string, data: any) => ApiClient.put<Student>(`/students/${id}`, data),
  delete: (id: string) => ApiClient.del(`/students/${id}`),
  move: (id: string, groupId: string) => ApiClient.post<Student>(`/students/${id}/move`, { group_id: groupId }),
  getPayments: (studentId: string) => ApiClient.get<StudentPayment[]>(`/students/${studentId}/payments`),
  deleted: (groupId?: string) =>
    ApiClient.get<Student[]>("/students", { params: { ...(groupId ? { groupId } : {}), status: "withdrawn" } }),
  restore: (id: string) => ApiClient.put<Student>(`/students/${id}`, { status: "active" }),
};
