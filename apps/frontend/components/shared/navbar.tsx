"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { Menu, Globe, Sun, Moon } from "lucide-react";
import { useTheme, initTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/lib/i18n/context";

interface NavbarProps {
  onToggleSidebar: () => void;
  title: string;
  breadcrumb?: ReactNode;
}

export default function Navbar({ onToggleSidebar, title, breadcrumb }: NavbarProps) {
  const { locale, setLocale, t } = useTranslation();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    initTheme();
  }, []);

  const toggleLanguage = () => {
    setLocale(locale === "en" ? "fr" : "en");
  };

  return (
    <header className="sticky top-0 z-30 h-16 bg-surface border-b border-border flex items-center justify-between px-4 lg:px-8">
      <div className="flex items-center gap-4 min-w-0">
        <button
          onClick={onToggleSidebar}
          className="lg:hidden h-10 w-10 flex items-center justify-center rounded-btn hover:bg-neutral-soft dark:hover:bg-white/10 transition-colors shrink-0"
          aria-label="Toggle sidebar"
        >
          <Menu size={20} />
        </button>
        {breadcrumb ?? (
          <h1 className="text-base lg:text-lg font-semibold text-text-primary truncate">{title}</h1>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={toggleTheme}
          className="h-9 w-9 flex items-center justify-center rounded-btn bg-background border border-border hover:bg-neutral-soft dark:hover:bg-white/10 transition-colors"
          aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
        >
          {theme === "light" ? (
            <Moon size={16} className="text-text-secondary" />
          ) : (
            <Sun size={16} className="text-text-secondary" />
          )}
        </button>

        <button
          onClick={toggleLanguage}
          className="hidden sm:flex h-9 px-3 items-center gap-2 rounded-btn bg-background border border-border hover:bg-neutral-soft dark:hover:bg-white/10 transition-colors"
          aria-label="Toggle language"
        >
          <Globe size={14} className="text-text-secondary" />
          <span className="text-xs font-medium text-text-primary uppercase">{locale}</span>
        </button>

      </div>
    </header>
  );
}
