import { ApiClient } from "./client";

export type HierarchyEntity = "level" | "field" | "professor" | "group" | "student";

export interface HierarchyConfiguration {
  id: string;
  name: string;
  entityOrder: HierarchyEntity[];
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HierarchyResolveResult {
  breadcrumbs: Array<{ type: HierarchyEntity; id: string; name: string; [key: string]: any }>;
  children: Array<{ id: string; name: string; [key: string]: any }>;
}

export const HIERARCHY_ENTITY_LABELS: Record<HierarchyEntity, string> = {
  level: "Levels",
  field: "Fields",
  professor: "Professors",
  group: "Groups",
  student: "Students",
};

export const HIERARCHY_ENTITY_ICONS: Record<HierarchyEntity, string> = {
  level: "Layers",
  field: "BookOpen",
  professor: "UserCheck",
  group: "Users",
  student: "Users",
};

export const hierarchyConfigApi = {
  list: () => ApiClient.get<HierarchyConfiguration[]>("/hierarchy-config"),

  getActive: () => ApiClient.get<HierarchyConfiguration>("/hierarchy-config/active"),

  getOne: (id: string) => ApiClient.get<HierarchyConfiguration>(`/hierarchy-config/${id}`),

  create: (data: { name: string; entityOrder: HierarchyEntity[] }) =>
    ApiClient.post<HierarchyConfiguration>("/hierarchy-config", data),

  update: (id: string, data: { name?: string; entityOrder?: HierarchyEntity[] }) =>
    ApiClient.patch<HierarchyConfiguration>(`/hierarchy-config/${id}`, data),

  activate: (id: string) =>
    ApiClient.post<HierarchyConfiguration>(`/hierarchy-config/${id}/activate`),

  delete: (id: string) =>
    ApiClient.del(`/hierarchy-config/${id}`),

  resetToDefault: () =>
    ApiClient.post<HierarchyConfiguration>("/hierarchy-config/reset"),

  resolve: (segments: Array<{ entityType: HierarchyEntity; entityId: string }>) =>
    ApiClient.get<HierarchyResolveResult>("/hierarchy/resolve", {
      params: { segments: JSON.stringify(segments) },
    }),
};
