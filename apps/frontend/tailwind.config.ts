import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#264EAE", 50: "#E8EEFB", 100: "#D1DCF5", 200: "#A3B9EB", 300: "#7597E0", 400: "#4774D6", 500: "#264EAE", 600: "#1F3F8A", 700: "#193066", 800: "#122042", 900: "#0B1016" },
        sky: { DEFAULT: "#77D4F2", 50: "#EBF8FD", 100: "#D7F1FB", 200: "#AFE3F7", 300: "#77D4F2", 400: "#4CC5E8", 500: "#33B5DB" },
        gold: { DEFAULT: "#F5B940", 50: "#FDF6E8", 100: "#FAEDCA", 200: "#F5DB95", 300: "#F5B940", 400: "#F2A630", 500: "#E5A530", 600: "#B4830F", 700: "#8A6410" },
        background: {
          DEFAULT: "var(--color-background)",
        },
        surface: {
          DEFAULT: "var(--color-surface)",
        },
        border: {
          DEFAULT: "var(--color-border)",
        },
        "text-primary": {
          DEFAULT: "var(--color-text-primary)",
        },
        "text-secondary": {
          DEFAULT: "var(--color-text-secondary)",
        },
        success: { DEFAULT: "#22C55E", soft: "#DCFCE7", strong: "#15803D", dark: { DEFAULT: "#4ADE80", soft: "rgba(34,197,94,0.15)", strong: "#86EFAC" } },
        warning: { DEFAULT: "#F59E0B", soft: "#FEF3C7", strong: "#B45309", dark: { DEFAULT: "#FBBF24", soft: "rgba(245,158,11,0.15)", strong: "#FCD34D" } },
        danger: { DEFAULT: "#EF4444", soft: "#FEE2E2", strong: "#B91C1C", dark: { DEFAULT: "#F87171", soft: "rgba(239,68,68,0.15)", strong: "#FCA5A5" } },
        info: { DEFAULT: "#3B82F6", soft: "#DBEAFE", strong: "#1D4ED8", dark: { DEFAULT: "#60A5FA", soft: "rgba(59,130,246,0.15)", strong: "#93C5FD" } },
        neutral: { soft: "#F3F4F6", strong: "#4B5563", dark: { soft: "rgba(255,255,255,0.08)", strong: "#9CA3AF" } },
      },
      fontFamily: {
        sans: ["var(--font-poppins)", "Manrope", "Nunito", "ui-sans-serif", "system-ui"],
      },
      fontSize: {
        h1: "32px",
        h2: "28px",
        h3: "22px",
        h4: "18px",
        body: "16px",
        small: "14px",
        caption: "12px",
      },
      fontWeight: {
        bold: "600",
        medium: "500",
        regular: "400",
      },
      borderRadius: {
        btn: "10px",
        input: "10px",
        card: "14px",
        modal: "18px",
        table: "12px",
      },
      boxShadow: {
        card: "0 4px 16px rgba(0,0,0,0.06)",
        hover: "0 8px 24px rgba(0,0,0,0.08)",
        modal: "0 16px 48px rgba(0,0,0,0.12)",
        dropdown: "0 8px 24px rgba(0,0,0,0.10)",
      },
      spacing: {
        1: "4px",
        2: "8px",
        3: "12px",
        4: "16px",
        6: "24px",
        8: "32px",
        10: "40px",
        12: "48px",
        16: "64px",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
