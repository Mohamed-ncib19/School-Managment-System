import { ApiClient } from "./client";

export interface FieldSummary {
  id: string;
  level_id: string;
  name: string;
  description: string | null;
  professors: number;
  groups: number;
  students: number;
}

export interface ProfessorSummary {
  id: string;
  field_id: string;
  full_name: string;
  phone: string;
  email: string | null;
  is_active: boolean;
  groups: number;
  students: number;
}

export interface LevelSummary {
  id: string;
  name: string;
  is_active: boolean;
  fields: number;
  professors: number;
  groups: number;
  students: number;
}

export interface GroupSummary {
  id: string;
  prof_id: string;
  name: string;
  capacity: number | null;
  schedule_notes: string | null;
  is_active: boolean;
  students: number;
}

export interface HierarchySummary {
  fields: FieldSummary[];
  professors: ProfessorSummary[];
  levels: LevelSummary[];
  groups: GroupSummary[];
}

/**
 * Counts computed in SQL. Replaces downloading every student (384 KB) just to
 * tally them in the browser.
 */
export interface DeleteImpact {
  level: number;
  field: number;
  professor: number;
  group: number;
  student: number;
  directChildren: Array<{ id: string; name: string; type: string }>;
}

export const hierarchyApi = {
  summary: () => ApiClient.get<HierarchySummary>("/hierarchy/summary"),
  fields: (levelId?: string) =>
    ApiClient.get<FieldSummary[]>("/hierarchy/fields", { params: levelId ? { levelId } : {} }),
  professors: (fieldId?: string) =>
    ApiClient.get<ProfessorSummary[]>("/hierarchy/professors", { params: fieldId ? { fieldId } : {} }),
  levels: () =>
    ApiClient.get<LevelSummary[]>("/hierarchy/levels"),
  groups: (profId?: string) =>
    ApiClient.get<GroupSummary[]>("/hierarchy/groups", { params: profId ? { profId } : {} }),
  deleteImpact: (type: string, id: string) =>
    ApiClient.get<DeleteImpact>(`/hierarchy/${type}/${id}/delete-impact`),
  archiveCascade: (type: string, id: string) =>
    ApiClient.post(`/hierarchy/${type}/${id}/archive-cascade`, {}),
  deleteCascade: (type: string, id: string) =>
    ApiClient.post(`/hierarchy/${type}/${id}/delete-cascade`, { confirm: true }),
  detachDelete: (type: string, id: string, plan: any) =>
    ApiClient.post(`/hierarchy/${type}/${id}/detach-delete`, { plan }),
};
