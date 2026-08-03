"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { systemApi } from "@/lib/api/system.api";
import type { SystemSettings } from "@/types";

export const systemKeys = {
  all: ["system-settings"] as const,
};

/**
 * Module toggles the settings screen can hide from the navigation, one per
 * screen or entity group so each school keeps exactly what it uses.
 */
export const FEATURE_KEYS = [
  "fields",
  "levels",
  "students",
  "professors",
  "groups",
  "attendance",
  "financial.dashboard",
  "financial.studentPayments",
  "financial.professorPayments",
  "financial.analytics",
  "financial.reports",
  "financial.transactions",
  "financial.settings",
  "import",
  "audit",
  "backups",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

/**
 * A feature is enabled unless the row explicitly stores `false` for it —
 * schools upgrading from before the toggles existed keep everything visible.
 */
export function isFeatureEnabled(features: Record<string, boolean> | undefined, key: FeatureKey): boolean {
  return features?.[key] !== false;
}

export function useSystemSettings() {
  return useQuery<SystemSettings>({
    queryKey: systemKeys.all,
    queryFn: systemApi.get,
    staleTime: 60_000,
  });
}

export function useUpdateSystemSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: systemApi.update,
    onSuccess: (result) => {
      queryClient.setQueryData(systemKeys.all, result);
      queryClient.invalidateQueries({ queryKey: systemKeys.all });
    },
  });
}
