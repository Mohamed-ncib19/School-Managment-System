import { ApiClient } from "./client";

export interface FieldSummary {
  id: string;
  name: string;
  description: string | null;
  professors: number;
  levels: number;
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
  levels: number;
  groups: number;
  students: number;
}

export interface LevelSummary {
  id: string;
  prof_id: string;
  name: string;
  is_active: boolean;
  groups: number;
  students: number;
}

export interface GroupSummary {
  id: string;
  level_id: string;
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
  fields: () => ApiClient.get<FieldSummary[]>("/hierarchy/fields"),
  professors: (fieldId?: string) =>
    ApiClient.get<ProfessorSummary[]>("/hierarchy/professors", { params: fieldId ? { fieldId } : {} }),
  levels: (profId?: string) =>
    ApiClient.get<LevelSummary[]>("/hierarchy/levels", { params: profId ? { profId } : {} }),
  groups: (levelId?: string) =>
    ApiClient.get<GroupSummary[]>("/hierarchy/groups", { params: levelId ? { levelId } : {} }),
};
