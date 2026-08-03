"use client";

import { CalendarDays, X } from "lucide-react";
import { useFields, useLevels, useProfessors, useGroups } from "@/hooks/use-queries";
import { cn } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";
import type { FinancialFilters } from "@/lib/api/financial.api";
import type { Granularity } from "@/types";

const QUICK_RANGES: { value: NonNullable<FinancialFilters["range"]>; label: string }[] = [
  { value: "today", label: "financial.today" },
  { value: "this_week", label: "financial.thisWeek" },
  { value: "this_month", label: "financial.thisMonth" },
  { value: "last_month", label: "financial.lastMonth" },
  { value: "this_year", label: "financial.thisYear" },
  { value: "academic_year", label: "financial.academicYear" },
];

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: "daily", label: "financial.daily" },
  { value: "weekly", label: "financial.weekly" },
  { value: "monthly", label: "financial.monthly" },
  { value: "quarterly", label: "financial.quarterly" },
  { value: "yearly", label: "financial.yearly" },
];

interface FinancialFilterBarProps {
  value: FinancialFilters;
  onChange: (next: FinancialFilters) => void;
  /** Hide the bucket-size control on screens that show no time series. */
  showGranularity?: boolean;
  showAcademic?: boolean;
}

/**
 * One filter row above the charts, shared by every financial screen.
 *
 * The academic selects cascade down the hierarchy — picking a field narrows the
 * professors offered, and a change higher up clears everything below it, so the
 * filter can never be left in a combination that describes nothing.
 *
 * Choosing a quick range clears any custom dates and vice versa: the two are
 * alternatives, and leaving both set would leave the reader unable to tell which
 * one the chart is honouring.
 */
export function FinancialFilterBar({
  value,
  onChange,
  showGranularity = true,
  showAcademic = true,
}: FinancialFilterBarProps) {
  const { t } = useTranslation();
  const { data: levels } = useLevels();
  const { data: fields } = useFields();
  const { data: professors } = useProfessors(value.fieldId || undefined);
  const { data: groups } = useGroups(value.profId || undefined);

  const set = (patch: Partial<FinancialFilters>) => onChange({ ...value, ...patch });

  const hasFilters = Boolean(
    value.range ||
      value.from ||
      value.to ||
      value.levelId ||
      value.fieldId ||
      value.profId ||
      value.groupId,
  );

  return (
    <div className="card space-y-3">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
          {t("financial.period", "Period")}
        </p>
        <div className="flex flex-wrap gap-2">
          {QUICK_RANGES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() =>
                set({
                  range: value.range === option.value ? undefined : option.value,
                  from: undefined,
                  to: undefined,
                })
              }
              aria-pressed={value.range === option.value}
              className={cn(
                "btn text-xs min-w-[110px]",
                value.range === option.value ? "btn-primary" : "btn-secondary",
              )}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <CalendarDays size={15} className="text-text-secondary shrink-0" aria-hidden="true" />
          <input
            type="date"
            aria-label={t("financial.from", "From")}
            value={value.from ?? ""}
            onChange={(e) => set({ from: e.target.value || undefined, range: undefined })}
            className="input w-auto text-xs"
          />
          <span className="text-text-secondary text-xs">&mdash;</span>
          <input
            type="date"
            aria-label={t("financial.to", "To")}
            value={value.to ?? ""}
            onChange={(e) => set({ to: e.target.value || undefined, range: undefined })}
            className="input w-auto text-xs"
          />
        </div>

        {showGranularity && (
          <select
            aria-label={t("financial.granularity", "Granularity")}
            value={value.granularity ?? "monthly"}
            onChange={(e) => set({ granularity: e.target.value as Granularity })}
            className="input w-auto min-w-[120px] text-xs"
          >
            {GRANULARITIES.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
        )}

        {showAcademic && (
          <>
            <select
              aria-label={t("nav.levels", "Levels")}
              value={value.levelId ?? ""}
              onChange={(e) =>
                set({
                  levelId: e.target.value || undefined,
                  fieldId: undefined,
                  profId: undefined,
                  groupId: undefined,
                })
              }
              className="input w-auto min-w-[130px] text-xs"
            >
              <option value="">{t("students.allLevels", "All levels")}</option>
              {levels?.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.name}
                </option>
              ))}
            </select>

            <select
              aria-label={t("nav.fields", "Fields")}
              value={value.fieldId ?? ""}
              onChange={(e) =>
                set({ fieldId: e.target.value || undefined, profId: undefined, groupId: undefined })
              }
              className="input w-auto min-w-[130px] text-xs"
            >
              <option value="">{t("students.allFields", "All fields")}</option>
              {fields
                ?.filter((field) => !value.levelId || field.level_id === value.levelId)
                .map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
            </select>

            <select
              aria-label={t("nav.professors", "Professors")}
              value={value.profId ?? ""}
              onChange={(e) => set({ profId: e.target.value || undefined, groupId: undefined })}
              disabled={!value.fieldId}
              className="input w-auto min-w-[140px] text-xs disabled:opacity-50"
            >
              <option value="">{t("students.allProfessors", "All professors")}</option>
              {professors?.map((professor) => (
                <option key={professor.id} value={professor.id}>
                  {professor.full_name}
                </option>
              ))}
            </select>

            <select
              aria-label={t("nav.groups", "Groups")}
              value={value.groupId ?? ""}
              onChange={(e) => set({ groupId: e.target.value || undefined })}
              disabled={!value.profId}
              className="input w-auto min-w-[130px] text-xs disabled:opacity-50"
            >
              <option value="">{t("students.allGroups", "All groups")}</option>
              {groups?.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </>
        )}

        {hasFilters && (
          <button
            type="button"
            onClick={() => onChange({ granularity: value.granularity })}
            className="btn btn-secondary text-xs"
          >
            <X size={13} aria-hidden="true" />
            {t("students.clearFilters", "Clear")}
          </button>
        )}
      </div>
    </div>
  );
}
