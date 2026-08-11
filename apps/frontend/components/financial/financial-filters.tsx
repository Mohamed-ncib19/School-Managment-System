"use client";

import { CalendarDays, ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
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
 * One compact filter strip above the charts, shared by every financial screen.
 *
 * Everything sits on a single line: the period select, the custom date window,
 * the bucket size and the "Filtres avancés" toggle. The academic cascade —
 * level → field → professor → group — stays behind that toggle so the screens
 * remain readable at a glance.
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { data: levels } = useLevels();
  const { data: fields } = useFields();
  const { data: professors } = useProfessors(value.fieldId || undefined);
  const { data: groups } = useGroups(value.profId || undefined);

  const set = (patch: Partial<FinancialFilters>) => onChange({ ...value, ...patch });

  const hasAcademic = Boolean(value.levelId || value.fieldId || value.profId || value.groupId);

  return (
    <div className="card px-4 py-2.5">
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="flex items-center gap-2">
          <CalendarDays size={15} className="text-text-secondary shrink-0" aria-hidden="true" />
          <select
            aria-label={t("financial.period", "Période")}
            value={value.range ?? ""}
            onChange={(e) =>
              set({ range: (e.target.value || undefined) as NonNullable<FinancialFilters["range"]>, from: undefined, to: undefined })
            }
            className="input w-auto min-w-[160px] text-xs"
          >
            <option value="">{t("financial.allPeriod", "Toute la période")}</option>
            {QUICK_RANGES.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </div>

        <input
          type="date"
          aria-label={t("financial.from", "Du")}
          value={value.from ?? ""}
          onChange={(e) => set({ from: e.target.value || undefined, range: undefined })}
          className="input w-auto text-xs"
        />
        <span className="text-text-secondary text-xs" aria-hidden="true">
          &mdash;
        </span>
        <input
          type="date"
          aria-label={t("financial.to", "Au")}
          value={value.to ?? ""}
          onChange={(e) => set({ to: e.target.value || undefined, range: undefined })}
          className="input w-auto text-xs"
        />

        {showGranularity && (
          <select
            aria-label={t("financial.granularity", "Granularité")}
            value={value.granularity ?? "monthly"}
            onChange={(e) => set({ granularity: e.target.value as Granularity })}
            className="input w-auto min-w-[130px] text-xs"
          >
            {GRANULARITIES.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
        )}

        {showAcademic && (
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            className={cn("btn text-xs", hasAcademic ? "btn-primary" : "btn-secondary")}
          >
            <SlidersHorizontal size={13} aria-hidden="true" />
            {t("financial.advancedFilters", "Filtres avancés")}
            <ChevronDown
              size={13}
              aria-hidden="true"
              className={cn("transition-transform duration-150", advancedOpen && "rotate-180")}
            />
          </button>
        )}

        {hasAcademic && (
          <button
            type="button"
            onClick={() =>
              set({ levelId: undefined, fieldId: undefined, profId: undefined, groupId: undefined })
            }
            className="btn btn-secondary text-xs"
          >
            <X size={13} aria-hidden="true" />
            {t("students.clearFilters", "Effacer")}
          </button>
        )}
      </div>

      {showAcademic && advancedOpen && (
        <div className="flex items-center gap-3 flex-wrap rounded-btn bg-background p-3 border border-border mt-3">
          <select
            aria-label={t("nav.levels", "Niveaux")}
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
            <option value="">{t("students.allLevels", "Tous les niveaux")}</option>
            {levels?.map((level) => (
              <option key={level.id} value={level.id}>
                {level.name}
              </option>
            ))}
          </select>

          <select
            aria-label={t("nav.fields", "Filières")}
            value={value.fieldId ?? ""}
            onChange={(e) =>
              set({ fieldId: e.target.value || undefined, profId: undefined, groupId: undefined })
            }
            className="input w-auto min-w-[130px] text-xs"
          >
            <option value="">{t("students.allFields", "Toutes les filières")}</option>
            {fields
              ?.filter((field) => !value.levelId || field.level_id === value.levelId)
              .map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
          </select>

          <select
            aria-label={t("nav.professors", "Professeurs")}
            value={value.profId ?? ""}
            onChange={(e) => set({ profId: e.target.value || undefined, groupId: undefined })}
            disabled={!value.fieldId}
            className="input w-auto min-w-[140px] text-xs disabled:opacity-50"
          >
            <option value="">{t("students.allProfessors", "Tous les professeurs")}</option>
            {professors?.map((professor) => (
              <option key={professor.id} value={professor.id}>
                {professor.full_name}
              </option>
            ))}
          </select>

          <select
            aria-label={t("nav.groups", "Groupes")}
            value={value.groupId ?? ""}
            onChange={(e) => set({ groupId: e.target.value || undefined })}
            disabled={!value.profId}
            className="input w-auto min-w-[130px] text-xs disabled:opacity-50"
          >
            <option value="">{t("students.allGroups", "Tous les groupes")}</option>
            {groups?.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
