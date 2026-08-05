"use client";

import { createContext, useContext, useEffect, useCallback, type ReactNode } from "react";

type Dictionary = Record<string, any>;

import frDict from "@/lib/i18n/dictionaries/fr.json";

/**
 * The product is French-only (locked with the client): the interface always
 * resolves to the French dictionary, whatever was stored on the device.
 */
const DICTIONARY: Dictionary = frDict as Dictionary;

interface I18nContextValue {
  locale: "fr";
  t: (key: string, fallback?: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getNestedValue(obj: any, path: string): string | undefined {
  return path.split(".").reduce((current, key) => current?.[key], obj);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const t = useCallback((key: string, fallback?: string): string => {
    const value = getNestedValue(DICTIONARY, key);
    if (typeof value === "string") return value;
    if (fallback) return fallback;
    return key;
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = "fr";
    }
  }, []);

  return (
    <I18nContext.Provider value={{ locale: "fr", t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useTranslation must be used within I18nProvider");
  return ctx;
}
