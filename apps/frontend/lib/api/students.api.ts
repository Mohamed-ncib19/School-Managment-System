import { ApiClient, type Paginated } from "./client";
import type { Student, StudentPayment } from "@/types";

/**
 * The scope a student list can be narrowed to.
 *
 * The academic keys mirror the backend's shared filter translation, so the
 * student list and the financial screens resolve "this level" identically.
 */
export type StudentSort = "newest" | "nameAsc" | "nameDesc" | "color";

export interface StudentListQuery {
  groupId?: string;
  profId?: string;
  fieldId?: string;
  levelId?: string;
  search?: string;
  status?: string;
  sort?: StudentSort;
  page?: number;
  limit?: number;
}

/** Drops empty values so a cleared dropdown never becomes `?fieldId=`. */
function params(input: StudentListQuery): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = String(value);
  }
  return out;
}

export const studentsApi = {
  /**
   * Legacy unbounded read, kept for the few callers that genuinely want a
   * whole small set. The server caps it — prefer `page()` for anything that
   * grows with enrolment.
   */
  list: (groupId?: string, search?: string) =>
    ApiClient.get<Student[]>("/students", { params: params({ groupId, search }) }),

  /** One page of students, filtered and counted server-side. */
  page: (query: StudentListQuery) =>
    ApiClient.getPaginated<Student>("/students", { params: params(query) }),

  recent: (limit = 5) => ApiClient.get<Student[]>(`/students/recent?limit=${limit}`),
  get: (id: string) => ApiClient.get<Student>(`/students/${id}`),
  create: (data: any) => ApiClient.post<Student>("/students", data),
  update: (id: string, data: any) => ApiClient.put<Student>(`/students/${id}`, data),
  delete: (id: string) => ApiClient.del(`/students/${id}`),
  move: (id: string, groupId: string) => ApiClient.post<Student>(`/students/${id}/move`, { group_id: groupId }),
  getPayments: (studentId: string) => ApiClient.get<StudentPayment[]>(`/students/${studentId}/payments`),

  /** Withdrawn students — the restorable "Deleted" space. */
  deleted: (groupId?: string, limit = 200) =>
    ApiClient.get<Student[]>("/students", {
      params: params({ groupId, status: "withdrawn", limit }),
    }),

  restore: (id: string) => ApiClient.put<Student>(`/students/${id}`, { status: "active" }),
};

export type { Paginated };
