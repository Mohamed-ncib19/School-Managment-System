import { ApiClient } from "./client";
import type { Group } from "@/types";

export const groupsApi = {
  list: (levelId?: string) =>
    ApiClient.get<Group[]>("/groups", { params: levelId ? { levelId } : {} }),
  get: (id: string) => ApiClient.get<Group>(`/groups/${id}`),
  create: (data: { level_id: string; name: string; capacity?: number; schedule_notes?: string }) =>
    ApiClient.post<Group>("/groups", data),
  update: (id: string, data: { name?: string; capacity?: number; schedule_notes?: string }) =>
    ApiClient.put<Group>(`/groups/${id}`, data),
  delete: (id: string) => ApiClient.del(`/groups/${id}`),
};
