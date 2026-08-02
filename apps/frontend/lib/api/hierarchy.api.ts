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
};
