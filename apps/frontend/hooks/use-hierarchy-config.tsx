"use client";

import React, { createContext, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  hierarchyConfigApi,
  type HierarchyConfiguration,
  type HierarchyEntity,
} from "@/lib/api/hierarchy-config.api";

interface HierarchyConfigContextValue {
  config: HierarchyConfiguration | null;
  entityOrder: HierarchyEntity[];
  isLoading: boolean;
  isError: boolean;
  getEntityIndex: (entity: HierarchyEntity) => number;
  getNextEntity: (currentEntity: HierarchyEntity) => HierarchyEntity | null;
  getPreviousEntity: (currentEntity: HierarchyEntity) => HierarchyEntity | null;
  getEntityLabel: (entity: HierarchyEntity) => string;
  refetch: () => void;
}

const HierarchyConfigContext = createContext<HierarchyConfigContextValue | null>(null);

const ENTITY_LABELS: Record<HierarchyEntity, string> = {
  level: "Niveaux",
  field: "Spécialités",
  professor: "Professeurs",
  group: "Groupes",
  student: "Étudiants",
};

const DEFAULT_ENTITY_ORDER: HierarchyEntity[] = ["level", "field", "professor", "group", "student"];

export function HierarchyConfigProvider({ children }: { children: React.ReactNode }) {
  const { data: config, isLoading, isError, refetch } = useQuery({
    queryKey: ["hierarchy-config", "active"],
    queryFn: hierarchyConfigApi.getActive,
    staleTime: 300_000,
    retry: 1,
  });

  const entityOrder = useMemo(() => {
    if (config?.entityOrder && Array.isArray(config.entityOrder)) {
      return config.entityOrder as HierarchyEntity[];
    }
    return DEFAULT_ENTITY_ORDER;
  }, [config]);

  const value = useMemo<HierarchyConfigContextValue>(() => {
    const getEntityIndex = (entity: HierarchyEntity): number => {
      return entityOrder.indexOf(entity);
    };

    const getNextEntity = (currentEntity: HierarchyEntity): HierarchyEntity | null => {
      const idx = getEntityIndex(currentEntity);
      if (idx === -1 || idx >= entityOrder.length - 1) return null;
      return entityOrder[idx + 1];
    };

    const getPreviousEntity = (currentEntity: HierarchyEntity): HierarchyEntity | null => {
      const idx = getEntityIndex(currentEntity);
      if (idx <= 0) return null;
      return entityOrder[idx - 1];
    };

    const getEntityLabel = (entity: HierarchyEntity): string => {
      return ENTITY_LABELS[entity] ?? entity;
    };

    return {
      config: config ?? null,
      entityOrder,
      isLoading,
      isError,
      getEntityIndex,
      getNextEntity,
      getPreviousEntity,
      getEntityLabel,
      refetch,
    };
  }, [config, entityOrder, isLoading, isError, refetch]);

  return (
    <HierarchyConfigContext.Provider value={value}>
      {children}
    </HierarchyConfigContext.Provider>
  );
}

export function useHierarchyConfig(): HierarchyConfigContextValue {
  const context = useContext(HierarchyConfigContext);
  if (!context) {
    throw new Error("useHierarchyConfig must be used within a HierarchyConfigProvider");
  }
  return context;
}

export function useEntityLabel(): (entity: HierarchyEntity) => string {
  const { getEntityLabel } = useHierarchyConfig();
  return getEntityLabel;
}

export type { HierarchyEntity };
export { ENTITY_LABELS };
