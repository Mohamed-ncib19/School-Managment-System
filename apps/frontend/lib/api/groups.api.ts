import { ApiClient } from "./client";
import type { Group } from "@/types";

export const groupsApi = {
  list: (profId?: string) =>
    ApiClient.get<Group[]>("/groups", { params: profId ? { profId } : {} }),
  get: (id: string) => ApiClient.get<Group>(`/groups/${id}`),
  create: (data: { prof_id: string; name: string; capacity?: number; schedule_notes?: string; color?: string }) =>
    ApiClient.post<Group>("/groups", data),
  update: (id: string, data: { name?: string; capacity?: number; schedule_notes?: string; color?: string }) =>
    ApiClient.put<Group>(`/groups/${id}`, data),
  delete: (id: string) => ApiClient.del(`/groups/${id}`),
  deleted: (profId?: string) =>
    ApiClient.get<Group[]>("/groups/deleted", { params: profId ? { profId } : {} }),
  restore: (id: string) =>
    ApiClient.post<Group>(`/groups/${id}/restore`),
  hardDelete: (id: string) =>
    ApiClient.del(`/groups/${id}/hard`),
};
