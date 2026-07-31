"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Menu, Search, Globe, ChevronDown, Sun, Moon } from "lucide-react";
import { useAuthStore } from "@/hooks/use-auth-store";
import { useTheme, initTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/lib/i18n/context";

interface NavbarProps {
  onToggleSidebar: () => void;
  title: string;
}

export default function Navbar({ onToggleSidebar, title }: NavbarProps) {
  const { user } = useAuthStore();
  const [searchQuery, setSearchQuery] = useState("");
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
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleSidebar}
          className="lg:hidden h-10 w-10 flex items-center justify-center rounded-btn hover:bg-neutral-soft dark:hover:bg-white/10 transition-colors"
          aria-label="Toggle sidebar"
        >
          <Menu size={20} />
        </button>
        <h1 className="text-base lg:text-lg font-semibold text-text-primary">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden md:flex items-center relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            placeholder={t("common.search", "Search...")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-64 pl-9 pr-4 rounded-btn bg-background border border-border text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary-200 transition-all"
          />
        </div>

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

        <div className="flex items-center gap-2 h-10 pl-2 pr-1 rounded-btn bg-background border border-border">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-primary-600 flex items-center justify-center text-white text-xs font-bold">
            {user?.full_name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "AD"}
          </div>
          <div className="hidden sm:block min-w-0">
            <p className="text-sm font-medium text-text-primary truncate max-w-[120px]">{user?.full_name ?? "Admin"}</p>
          </div>
          <button className="h-8 w-8 flex items-center justify-center rounded-btn hover:bg-neutral-soft dark:hover:bg-white/10 transition-colors" aria-label="User menu">
            <ChevronDown size={14} className="text-text-secondary" />
          </button>
        </div>
      </div>
    </header>
  );
}
