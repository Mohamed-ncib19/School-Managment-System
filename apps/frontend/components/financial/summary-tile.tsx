"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/format";

interface SummaryTileProps {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "danger";
  badge?: ReactNode;
}

/**
 * The summary strip that opens every financial list and detail screen: label,
 * value, optional tone and an optional status badge. One component so every
 * screen reads identically.
 */
export function SummaryTile({ label, value, tone = "neutral", badge }: SummaryTileProps) {
  return (
    <div className="card py-3">
      <p className="text-xs text-text-secondary">{label}</p>
      <p
        className={cn(
          "text-h4 font-bold tabular-nums mt-0.5",
          tone === "positive" && "text-success-strong",
          tone === "danger" && "text-danger-strong",
          tone === "neutral" && "text-text-primary",
        )}
      >
        {value}
      </p>
      {badge && <div className="mt-1.5">{badge}</div>}
    </div>
  );
}
