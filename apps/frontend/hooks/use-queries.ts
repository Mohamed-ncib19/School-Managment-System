"use client";

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { ApiClient } from "@/lib/api/client";
import type { Field, Professor, Level, Group, Student } from "@/types";

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

export function useLevels(profId?: string, options?: Omit<UseQueryOptions<Level[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["levels", profId],
    queryFn: async () => {
      const params = profId ? { profId } : {};
      return ApiClient.get<Level[]>("/levels", { params });
    },
    ...options,
  });
}

export function useGroups(levelId?: string, options?: Omit<UseQueryOptions<Group[]>, "queryKey" | "queryFn">) {
  return useQuery({
    queryKey: ["groups", levelId],
    queryFn: async () => {
      const params = levelId ? { levelId } : {};
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
