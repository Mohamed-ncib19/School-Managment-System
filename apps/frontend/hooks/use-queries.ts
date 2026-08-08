"use client";

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { ApiClient } from "@/lib/api/client";
import { hierarchyApi, type HierarchySummary } from "@/lib/api/hierarchy.api";
import { studentsApi } from "@/lib/api/students.api";
import type { Field, Professor, Level, Group, Student } from "@/types";

/**
 * Roll-up counts for the hierarchy pages, aggregated server-side.
 *
 * Prefer this over pulling `useStudents()` (and friends) purely to count rows:
 * the summary is a fraction of a kilobyte, where the student list alone is
 * 384 KB and grows with every enrolment.
 */
export function useHierarchySummary(
  options?: Omit<UseQueryOptions<HierarchySummary>, "queryKey" | "queryFn">,
) {
  return useQuery({
    queryKey: ["hierarchy-summary"],
    queryFn: hierarchyApi.summary,
    staleTime: 60_000,
    ...options,
  });
}

export function useFields(options?: Omit<UseQueryOptions<Field[]>, "queryKey" | "queryFn">) {
  return useQuery({ queryKey: ["fields"], queryFn: async () => ApiClient.get<Field[]>("/fields"), ...options });
}

export function useProfessors(fieldId?: string, options?: Omit<UseQueryOptions<Professor[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["professors", fieldId],
    queryFn: async () => {
      const params = fieldId ? { fieldId } : {};
      return ApiClient.get<Professor[]>("/professors", { params });
    },
    ...options,
  });
}

export function useLevels(options?: Omit<UseQueryOptions<Level[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["levels"],
    queryFn: async () => ApiClient.get<Level[]>("/levels"),
    ...options,
  });
}

export function useGroups(profId?: string, options?: Omit<UseQueryOptions<Group[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["groups", profId],
    queryFn: async () => {
      const params = profId ? { profId } : {};
      return ApiClient.get<Group[]>("/groups", { params });
    },
    ...options,
  });
}

export function useStudents(groupId?: string, options?: Omit<UseQueryOptions<Student[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["students", groupId],
    queryFn: async () => {
      const params = groupId ? { groupId } : {};
      return ApiClient.get<Student[]>("/students", { params });
    },
    ...options,
  });
}

export function useRecentStudents(limit = 5, options?: Omit<UseQueryOptions<Student[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["students", "recent", limit],
    queryFn: async () => studentsApi.recent(limit),
    staleTime: 60_000,
    ...options,
  });
}

/**
 * Students matching a name/phone term, with their full enrollment chain.
 *
 * The payments screen uses this to scope the hierarchy filters to the student
 * being searched: every dropdown then only offers fields, professors and groups
 * the matched students actually belong to.
 */
export function useStudentSearch(
  search: string,
  options?: Omit<UseQueryOptions<Student[]>, "queryKey" | "queryFn">,
) {
  const term = search.trim();
  return useQuery({
    queryKey: ["students", "search", term],
    queryFn: async () => studentsApi.list(undefined, term),
    enabled: term.length > 0,
    staleTime: 30_000,
    ...options,
  });
}
