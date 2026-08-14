"use client";

import { Users } from "lucide-react";
import type { MultiGroupCheck } from "@/types";
import { useTranslation } from "@/lib/i18n/context";

interface MultiGroupBadgeProps {
  eligibility: MultiGroupCheck | undefined;
  onClick: () => void;
}

export function MultiGroupBadge({ eligibility, onClick }: MultiGroupBadgeProps) {
  const { t } = useTranslation();
  if (!eligibility?.eligible) return null;

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary-50 text-primary text-xs font-medium hover:bg-primary-100 transition-colors"
      title={t("scheduling.generateTimetable")}
    >
      <Users size={12} />
      {eligibility.groupCount}G
    </button>
  );
}
