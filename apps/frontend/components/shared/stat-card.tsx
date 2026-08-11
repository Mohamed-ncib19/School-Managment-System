"use client";

import type { ReactNode } from "react";
import { useTranslation } from "@/lib/i18n/context";

interface StatCardProps {
  icon: ReactNode;
  title: string;
  value: string | number;
  trend?: { value: string; positive: boolean };
  titleKey?: string;
}

export function StatCard({ icon, title, value, trend, titleKey }: StatCardProps) {
  const { t } = useTranslation();
  const displayTitle = titleKey ? t(titleKey) : title;

  return (
    <div className="card flex items-center gap-4">
      <div className="h-11 w-11 rounded-card bg-neutral-soft dark:bg-white/[0.08] flex items-center justify-center text-text-secondary shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm text-text-secondary truncate">{displayTitle}</p>
        <div className="flex items-baseline gap-2">
          <p className="text-xl font-bold text-text-primary tabular-nums">{value}</p>
          {trend && (
            <span className={`text-xs font-medium shrink-0 ${trend.positive ? "text-green-600" : "text-red-500"}`}>
              {trend.positive ? "↑" : "↓"} {trend.value}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
