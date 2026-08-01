"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ViewMode } from "@/components/shared/view-toggle";

const STORAGE_KEY = "iq-view-mode";

const isViewMode = (value: unknown): value is ViewMode =>
  value === "list" || value === "tree" || value === "cards";

/**
 * One shared view preference for the whole hierarchy.
 *
 * Field > Professor > Level > Class > Student are separate routes, so the
 * choice has to live outside any one page. It is held in a module-level store
 * (kept in sync with localStorage) rather than in per-component state: with
 * `useState` in each caller, two components mounted at once drifted apart, and
 * the value only reached the page after the first paint.
 */
let cachedMode: ViewMode | null | undefined;
const listeners = new Set<() => void>();

function readStored(): ViewMode | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isViewMode(stored) ? stored : null;
  } catch {
    // Private mode / storage disabled: fall back to the default silently.
    return null;
  }
}

function getSnapshot(): ViewMode | null {
  if (cachedMode === undefined) cachedMode = readStored();
  return cachedMode;
}

/** The server has no preference; React re-renders with the real one after hydration. */
const getServerSnapshot = (): ViewMode | null => null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  listeners.forEach((listener) => listener());
}

function writeMode(mode: ViewMode) {
  cachedMode = mode;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Preference is still applied for this session even if it cannot persist.
  }
  emit();
}

// Another tab changing the preference keeps this one in step.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    cachedMode = isViewMode(event.newValue) ? event.newValue : null;
    emit();
  });
}

export function useViewMode(defaultMode: ViewMode = "list") {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const setViewMode = useCallback((mode: ViewMode) => writeMode(mode), []);

  return {
    // The stored preference wins at every level of the hierarchy; the page's
    // default applies only until the user has expressed one.
    viewMode: stored ?? defaultMode,
    setViewMode,
    /** False during SSR and the first client render - useful to defer animations. */
    mounted,
  };
}
