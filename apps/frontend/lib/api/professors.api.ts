import { ApiClient } from "./client";
import type { Professor } from "@/types";

export const professorsApi = {
  list: (fieldId?: string) =>
    ApiClient.get<Professor[]>("/professors", { params: fieldId ? { fieldId } : {} }),
  get: (id: string) => ApiClient.get<Professor>(`/professors/${id}`),
  create: (data: { field_id: string; full_name: string; phone: string; email?: string; color?: string; user_id?: string }) =>
    ApiClient.post<Professor>("/professors", data),
  update: (id: string, data: { full_name?: string; phone?: string; email?: string; color?: string; user_id?: string; is_active?: boolean }) =>
    ApiClient.put<Professor>(`/professors/${id}`, data),
  deactivate: (id: string) => ApiClient.del(`/professors/${id}`),
  deleted: (fieldId?: string) =>
    ApiClient.get<Professor[]>("/professors/deleted", { params: fieldId ? { fieldId } : {} }),
  restore: (id: string) =>
    ApiClient.post<Professor>(`/professors/${id}/restore`),
  hardDelete: (id: string) =>
    ApiClient.del(`/professors/${id}/hard`),
};
