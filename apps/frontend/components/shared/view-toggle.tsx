"use client";

import { LayoutList, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";

export type ViewMode = "list" | "cards";

interface ViewToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  className?: string;
}

export function ViewToggle({ value, onChange, className }: ViewToggleProps) {
  const { t } = useTranslation();
  const options = [
    { mode: "list" as ViewMode, icon: <LayoutList size={16} />, label: t("viewToggle.list") },
    { mode: "cards" as ViewMode, icon: <LayoutGrid size={16} />, label: t("viewToggle.cards") },
  ];
  return (
    <div className={cn("flex items-center gap-1 rounded-btn border border-border bg-surface p-1", className)}>
      {options.map((option) => (
        <button
          key={option.mode}
          onClick={() => onChange(option.mode)}
          className={cn(
            "flex items-center gap-2 rounded-btn px-3 py-1.5 text-xs font-medium transition-colors",
            value === option.mode
              ? "bg-primary text-white"
              : "text-text-secondary hover:bg-background hover:text-text-primary"
          )}
          aria-label={option.label}
          title={option.label}
        >
          {option.icon}
          <span className="hidden sm:inline">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
