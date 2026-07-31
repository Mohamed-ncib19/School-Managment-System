"use client";

import { UserCheck } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";

interface Teacher {
  id: string;
  full_name: string;
  phone: string;
  email?: string | null;
  field?: { name: string };
  levels?: { name: string }[];
}

interface TeacherOverviewCardProps {
  teacher: Teacher;
}

export default function TeacherOverviewCard({ teacher }: TeacherOverviewCardProps) {
  const { t } = useTranslation();
  const initials = teacher.full_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="card flex items-center gap-5 hover:shadow-hover transition-shadow">
      <div className="h-16 w-16 rounded-full bg-gradient-to-br from-primary to-primary-600 flex items-center justify-center text-white text-lg font-bold shadow-md shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <UserCheck size={16} className="text-primary" />
          <h3 className="text-h4 font-bold text-text-primary truncate">{teacher.full_name}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-secondary">
          <span className="inline-flex items-center gap-1.5">
            {teacher.field?.name ?? t("common.noFieldAssigned")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            {teacher.phone}
          </span>
          {teacher.email && (
            <span className="inline-flex items-center gap-1.5">
              {teacher.email}
            </span>
          )}
        </div>
        {teacher.levels && teacher.levels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {teacher.levels.map((level) => (
              <span key={level.name} className="inline-flex items-center rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary border border-primary-100">
                {level.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="hidden lg:flex flex-col items-end gap-1 shrink-0">
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">{t("common.teaching")}</span>
        <span className="text-sm font-semibold text-text-primary">{teacher.levels?.[0]?.name ?? "—"}</span>
      </div>
    </div>
  );
}
