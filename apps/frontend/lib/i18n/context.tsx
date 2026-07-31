"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

type Locale = "en" | "fr";

type Dictionary = Record<string, any>;

const DICTIONARIES: Record<Locale, Dictionary | undefined> = {
  en: undefined,
  fr: undefined,
};

async function loadDictionary(locale: Locale): Promise<Dictionary> {
  if (DICTIONARIES[locale]) return DICTIONARIES[locale]!;
  try {
    const mod = await import(`@/lib/i18n/dictionaries/${locale}.json`);
    DICTIONARIES[locale] = (mod.default || mod) as Dictionary;
    return DICTIONARIES[locale]!;
  } catch {
    DICTIONARIES[locale] = {};
    return {};
  }
}

async function ensureDictionariesLoaded() {
  await Promise.all([loadDictionary("en"), loadDictionary("fr")]);
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, fallback?: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getNestedValue(obj: any, path: string): string | undefined {
  return path.split(".").reduce((current, key) => current?.[key], obj);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    ensureDictionariesLoaded().then(() => setReady(true));
  }, []);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("iq-locale") : null;
    if (stored === "fr") {
      setLocaleState(stored);
    }
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("iq-locale", next);
    }
  }, []);

  const t = useCallback(
    (key: string, fallback?: string): string => {
      const dict = DICTIONARIES[locale];
      if (!dict) {
        if (fallback) return fallback;
        return key;
      }
      const value = getNestedValue(dict, key);
      if (typeof value === "string") return value;
      if (fallback) return fallback;
      return key;
    },
    [locale],
  );

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  if (!ready) return null;

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useTranslation must be used within I18nProvider");
  return ctx;
}
