import { ApiClient } from "./client";
import type { Level } from "@/types";

export const levelsApi = {
  list: () =>
    ApiClient.get<Level[]>("/levels"),
  get: (id: string) => ApiClient.get<Level>(`/levels/${id}`),
  create: (data: { name: string; color?: string }) =>
    ApiClient.post<Level>("/levels", data),
  update: (id: string, data: { name?: string; color?: string }) =>
    ApiClient.put<Level>(`/levels/${id}`, data),
  delete: (id: string) => ApiClient.del(`/levels/${id}`),
  deleted: () =>
    ApiClient.get<Level[]>("/levels/deleted"),
  restore: (id: string) =>
    ApiClient.post<Level>(`/levels/${id}/restore`),
  hardDelete: (id: string) =>
    ApiClient.del(`/levels/${id}/hard`),
};
