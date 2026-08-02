import { ApiClient } from "./client";
import type { Field } from "@/types";

export const fieldsApi = {
  list: (levelId?: string) =>
    ApiClient.get<Field[]>("/fields", { params: levelId ? { levelId } : {} }),
  get: (id: string) => ApiClient.get<Field>(`/fields/${id}`),
  create: (data: { name: string; description?: string; color?: string; created_by?: string }) =>
    ApiClient.post<Field>("/fields", data),
  update: (id: string, data: { name?: string; description?: string; color?: string }) =>
    ApiClient.put<Field>(`/fields/${id}`, data),
  remove: (id: string) => ApiClient.del(`/fields/${id}`),
  deleted: (levelId?: string) =>
    ApiClient.get<Field[]>("/fields/deleted", { params: levelId ? { levelId } : {} }),
  restore: (id: string) =>
    ApiClient.post<Field>(`/fields/${id}/restore`),
  hardDelete: (id: string) =>
    ApiClient.del(`/fields/${id}/hard`),
};
