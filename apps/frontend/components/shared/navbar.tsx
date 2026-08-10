"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { Menu, Sun, Moon } from "lucide-react";
import { useAppearance, initAppearance } from "@/hooks/use-appearance";
import ShutdownButton from "./shutdown-button";
import UpdateIndicator from "./update-indicator";

interface NavbarProps {
  onToggleSidebar: () => void;
  title: string;
  breadcrumb?: ReactNode;
}

export default function Navbar({ onToggleSidebar, title, breadcrumb }: NavbarProps) {
  const { theme, toggleTheme } = useAppearance();

  useEffect(() => {
    initAppearance();
  }, []);

  return (
    <header className="sticky top-0 z-30 h-16 bg-surface border-b border-border flex items-center justify-between px-4 lg:px-8 dark:glass">
      <div className="flex items-center gap-4 min-w-0">
        <button
          onClick={onToggleSidebar}
          className="lg:hidden h-10 w-10 flex items-center justify-center rounded-btn hover:bg-neutral-soft dark:hover:bg-white/10 transition-colors shrink-0"
          aria-label="Basculer la barre latérale"
        >
          <Menu size={20} />
        </button>
        {breadcrumb ?? (
          <h1 className="text-base lg:text-lg font-semibold text-text-primary truncate">{title}</h1>
        )}
      </div>

      <div className="flex items-center gap-3">
        <UpdateIndicator />
        <ShutdownButton />
        <button
          onClick={toggleTheme}
          className="h-9 w-9 flex items-center justify-center rounded-btn bg-background border border-border hover:bg-neutral-soft dark:hover:bg-white/10 transition-colors"
          aria-label={theme === "light" ? "Passer en mode sombre" : "Passer en mode clair"}
        >
          {theme === "light" ? (
            <Moon size={16} className="text-text-secondary" />
          ) : (
            <Sun size={16} className="text-text-secondary" />
          )}
        </button>
      </div>
    </header>
  );
}
