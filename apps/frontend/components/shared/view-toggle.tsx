"use client";

import { LayoutList, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils/format";

export type ViewMode = "list" | "cards";

interface ViewToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  className?: string;
}

const VIEW_OPTIONS: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
  { mode: "list", icon: <LayoutList size={16} />, label: "List" },
  { mode: "cards", icon: <LayoutGrid size={16} />, label: "Cards" },
];

export function ViewToggle({ value, onChange, className }: ViewToggleProps) {
  return (
    <div className={cn("flex items-center gap-1 rounded-btn border border-border bg-surface p-1", className)}>
      {VIEW_OPTIONS.map((option) => (
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