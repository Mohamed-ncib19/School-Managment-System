import { ApiClient } from "./client";
import type { Field } from "@/types";

export const fieldsApi = {
  list: () => ApiClient.get<Field[]>("/fields"),
  get: (id: string) => ApiClient.get<Field>(`/fields/${id}`),
  create: (data: { name: string; description?: string; created_by?: string }) =>
    ApiClient.post<Field>("/fields", data),
  update: (id: string, data: { name?: string; description?: string }) =>
    ApiClient.put<Field>(`/fields/${id}`, data),
  remove: (id: string) => ApiClient.del(`/fields/${id}`),
};
