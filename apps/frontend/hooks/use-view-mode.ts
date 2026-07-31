"use client";

import { useState, useEffect, useCallback } from "react";
import type { ViewMode } from "@/components/shared/view-toggle";

const STORAGE_KEY = "iq-view-mode";

export function useViewMode(defaultMode: ViewMode = "list") {
  const [viewMode, setViewModeState] = useState<ViewMode>(defaultMode);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (stored && (stored === "list" || stored === "tree" || stored === "cards")) {
      setViewModeState(stored);
    }
  }, []);

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      setViewModeState(mode);
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, mode);
      }
    },
    [],
  );

  return { viewMode, setViewMode, mounted };
}
