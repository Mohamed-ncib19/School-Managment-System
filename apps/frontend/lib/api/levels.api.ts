import { ApiClient } from "./client";
import type { Level } from "@/types";

export const levelsApi = {
  list: (profId?: string) =>
    ApiClient.get<Level[]>("/levels", { params: profId ? { profId } : {} }),
  get: (id: string) => ApiClient.get<Level>(`/levels/${id}`),
  create: (data: { prof_id: string; name: string }) =>
    ApiClient.post<Level>("/levels", data),
  update: (id: string, data: { name?: string }) =>
    ApiClient.put<Level>(`/levels/${id}`, data),
  delete: (id: string) => ApiClient.del(`/levels/${id}`),
};
