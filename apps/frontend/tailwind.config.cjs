/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "rgb(var(--color-primary) / <alpha-value>)", 50: "rgb(var(--color-primary-50) / <alpha-value>)", 100: "rgb(var(--color-primary-100) / <alpha-value>)", 200: "rgb(var(--color-primary-200) / <alpha-value>)", 300: "rgb(var(--color-primary-300) / <alpha-value>)", 400: "rgb(var(--color-primary-400) / <alpha-value>)", 500: "rgb(var(--color-primary-500) / <alpha-value>)", 600: "rgb(var(--color-primary-600) / <alpha-value>)", 700: "rgb(var(--color-primary-700) / <alpha-value>)", 800: "rgb(var(--color-primary-800) / <alpha-value>)", 900: "rgb(var(--color-primary-900) / <alpha-value>)" },
        sky: { DEFAULT: "#77D4F2", 50: "#EBF8FD", 100: "#D7F1FB", 200: "#AFE3F7", 300: "#77D4F2", 400: "#4CC5E8", 500: "#33B5DB" },
        gold: { DEFAULT: "rgb(var(--color-gold) / <alpha-value>)", 50: "rgb(var(--color-gold-50) / <alpha-value>)", 100: "rgb(var(--color-gold-100) / <alpha-value>)", 200: "rgb(var(--color-gold-200) / <alpha-value>)", 300: "rgb(var(--color-gold-300) / <alpha-value>)", 400: "rgb(var(--color-gold-400) / <alpha-value>)", 500: "rgb(var(--color-gold-500) / <alpha-value>)", 600: "rgb(var(--color-gold-600) / <alpha-value>)", 700: "rgb(var(--color-gold-700) / <alpha-value>)" },
        background: {
          DEFAULT: "var(--color-background)",
        },
        surface: {
          DEFAULT: "var(--color-surface)",
          elevated: "var(--color-surface-elevated, #FFFFFF)",
          hover: "var(--color-surface-hover, transparent)",
          active: "var(--color-surface-active, transparent)",
          inset: "var(--color-surface-inset, #F5F5F7)",
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
        sans: ["var(--font-inter)", "SF Pro Display", "Segoe UI", "ui-sans-serif", "system-ui"],
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
        modal: "20px",
        table: "12px",
      },
      boxShadow: {
        card: "var(--shadow-card, 0 1px 2px rgba(0,0,0,0.05), 0 6px 16px rgba(0,0,0,0.05))",
        hover: "var(--shadow-hover, 0 2px 4px rgba(0,0,0,0.06), 0 12px 24px rgba(0,0,0,0.10))",
        modal: "var(--shadow-modal, 0 8px 16px rgba(0,0,0,0.08), 0 32px 80px rgba(0,0,0,0.20))",
        dropdown: "var(--shadow-dropdown, 0 2px 4px rgba(0,0,0,0.05), 0 12px 32px rgba(0,0,0,0.12))",
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
