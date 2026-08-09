"use client";

import { create } from "zustand";

type Theme = "light" | "dark";

export type AccentId = "blue" | "emerald" | "violet" | "crimson";

interface AccentPreset {
  id: AccentId;
  /** Brand colour shown on the swatch. */
  swatch: string;
  /** The Tailwind-primary ramp, indexes 50…900. */
  ramp: [string, string, string, string, string, string, string, string, string, string];
  /** The secondary "gold" ramp, indexes 400…700 with DEFAULT at [0]. */
  goldRamp: [string, string, string, string, string, string, string, string, string];
}

const THEME_KEYS = [
  "--color-primary",
  "--color-primary-50",
  "--color-primary-100",
  "--color-primary-200",
  "--color-primary-300",
  "--color-primary-400",
  "--color-primary-500",
  "--color-primary-600",
  "--color-primary-700",
  "--color-primary-800",
  "--color-primary-900",
] as const;

const GOLD_KEYS = [
  "--color-gold",
  "--color-gold-50",
  "--color-gold-100",
  "--color-gold-200",
  "--color-gold-300",
  "--color-gold-400",
  "--color-gold-500",
  "--color-gold-600",
  "--color-gold-700",
] as const;

export const ACCENT_PRESETS: Record<AccentId, AccentPreset> = {
  blue: {
    id: "blue",
    swatch: "#264EAE",
    ramp: ["232 238 251", "209 220 245", "163 185 235", "117 151 224", "71 116 214", "38 78 174", "31 63 138", "25 48 102", "18 32 66", "11 16 22"],
    goldRamp: ["245 185 64", "253 246 232", "250 237 202", "245 219 149", "240 201 102", "242 166 48", "229 165 48", "180 131 15", "138 100 16"],
  },
  emerald: {
    id: "emerald",
    swatch: "#047857",
    ramp: ["231 247 240", "200 239 224", "159 223 196", "95 199 159", "44 170 121", "7 136 87", "5 112 74", "3 90 61", "2 69 46", "2 31 24"],
    goldRamp: ["237 166 75", "251 243 227", "247 233 198", "240 215 146", "234 197 107", "229 180 85", "214 162 63", "169 124 43", "133 94 30"],
  },
  violet: {
    id: "violet",
    swatch: "#7C3AED",
    ramp: ["245 243 255", "237 233 254", "213 214 254", "196 181 253", "167 139 250", "139 92 246", "124 58 237", "109 40 217", "91 33 182", "46 16 101"],
    goldRamp: ["228 192 90", "251 245 230", "246 236 199", "227 218 143", "232 205 110", "225 191 88", "211 172 66", "162 125 44", "124 93 30"],
  },
  crimson: {
    id: "crimson",
    swatch: "#BE123C",
    ramp: ["255 241 242", "253 235 238", "255 205 219", "249 164 175", "251 113 133", "244 63 94", "225 29 72", "190 18 60", "159 18 57", "76 5 25"],
    goldRamp: ["240 182 63", "250 235 195", "246 218 140", "242 203 102", "240 186 76", "240 182 63", "224 169 58", "174 126 38", "138 97 29"],
  },
};

export const ACCENT_IDS = Object.keys(ACCENT_PRESETS) as AccentId[];

interface AppearanceStore {
  theme: Theme;
  accent: AccentId;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setAccent: (accent: AccentId) => void;
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("iq-theme") as Theme | null;
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialAccent(): AccentId {
  if (typeof window === "undefined") return "blue";
  const stored = localStorage.getItem("iq-accent") as AccentId | null;
  return ACCENT_IDS.includes(stored as AccentId) ? (stored as AccentId) : "blue";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  localStorage.setItem("iq-theme", theme);
}

/**
 * The accent is written both as a `<html data-accent>` attribute (charts and
 * dark-mode fills read it from the stylesheet) and as inline variables (the
 * whole Tailwind `primary` and `gold` ramps read those). Blue is the default:
 * it clears the attribute and leaves the stylesheet defaults in place.
 */
function applyAccent(accent: AccentId) {
  const root = document.documentElement;
  if (accent === "blue") {
    delete root.dataset.accent;
    for (const key of THEME_KEYS) root.style.removeProperty(key);
    for (const key of GOLD_KEYS) root.style.removeProperty(key);
    localStorage.setItem("iq-accent", accent);
    return;
  }
  root.dataset.accent = accent;
  const ramp = ACCENT_PRESETS[accent].ramp;
  root.style.setProperty("--color-primary", ramp[5]);
  for (let i = 0; i < THEME_KEYS.length - 1; i++) {
    root.style.setProperty(THEME_KEYS[i + 1], ramp[i]);
  }
  const goldRamp = ACCENT_PRESETS[accent].goldRamp;
  root.style.setProperty("--color-gold", goldRamp[0]);
  for (let i = 1; i < GOLD_KEYS.length; i++) {
    root.style.setProperty(GOLD_KEYS[i], goldRamp[i]);
  }
  localStorage.setItem("iq-accent", accent);
}

export const useAppearance = create<AppearanceStore>((set) => ({
  theme: "light",
  accent: "blue",
  toggleTheme: () =>
    set((state) => {
      const next = state.theme === "light" ? "dark" : "light";
      applyTheme(next);
      return { theme: next };
    }),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  setAccent: (accent) => {
    applyAccent(accent);
    set({ accent });
  },
}));

export function initAppearance() {
  const theme = getInitialTheme();
  const accent = getInitialAccent();
  applyTheme(theme);
  applyAccent(accent);
  useAppearance.setState({ theme, accent });
}