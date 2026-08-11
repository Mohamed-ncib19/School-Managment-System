"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Search, UserCheck } from "lucide-react";
import { usePayroll } from "@/hooks/use-financial";
import { useFields, useLevels } from "@/hooks/use-queries";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/financial/error-state";
import { SummaryTile } from "@/components/financial/summary-tile";
import { FinancialTableSkeleton } from "@/components/shared/skeletons";
import { payrollStatusClasses } from "@/lib/charts/theme";
import { cn, formatCurrency } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";
import type { PayrollRow } from "@/types";

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

const STATUSES = [
  { value: "", label: "payments.all" },
  { value: "unpaid", label: "financial.payroll.unpaid" },
  { value: "partial", label: "financial.payroll.partial" },
  { value: "paid", label: "financial.payroll.paid" },
];

/**
 * Professor Payments — what each professor earned this period and what is still
 * owed to them.
 *
 * Earnings are not a stored figure: the server derives them from the shares
 * apportioned at collection time plus any salary element, and compares against
 * what has actually been handed over. That is why the status column can never
 * go stale when a late payment comes in.
 */
export default function ProfessorPaymentsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [period, setPeriod] = useState(currentPeriod());
  const [levelId, setLevelId] = useState("");
  const [fieldId, setFieldId] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const debouncedSearch = useDebouncedValue(search, 300);
  const { data: levels } = useLevels();
  const { data: fields } = useFields();

  const query = useMemo(
    () => ({
      period,
      levelId: levelId || undefined,
      fieldId: fieldId || undefined,
      status: status || undefined,
      search: debouncedSearch || undefined,
    }),
    [period, levelId, fieldId, status, debouncedSearch],
  );

  const { data, isLoading, isFetching, isError, refetch } = usePayroll(query);
  const rows = data?.data ?? [];
  const totals = data?.meta?.totals;

  const hasFilters = Boolean(search || levelId || fieldId || status);

  const clearFilters = () => {
    setSearch("");
    setLevelId("");
    setFieldId("");
    setStatus("");
    setPeriod(currentPeriod());
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-h2 font-bold text-text-primary mb-1">
          {t("financial.nav.professorPayments", "Paiements professeurs")}
        </h1>
        <p className="text-sm text-text-secondary">
          {t("financial.professorsSub", "Calculer la paie des professeurs et exporter les bordereaux de règlement.")}
        </p>
      </div>

      {isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <>
          <div className="card space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
                <input
                  type="text"
                  placeholder={t("financial.searchProfessors", "Rechercher un professeur…")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="input pl-9 w-full text-xs"
                />
              </div>
              <input
                type="month"
                aria-label={t("payments.period", "Period")}
                value={period}
                onChange={(e) => setPeriod(e.target.value || currentPeriod())}
                className="input w-auto text-xs"
              />
              <select
                aria-label={t("nav.levels", "Levels")}
                value={levelId}
                onChange={(e) => {
                  setLevelId(e.target.value);
                  setFieldId("");
                }}
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
                value={fieldId}
                onChange={(e) => setFieldId(e.target.value)}
                className="input w-auto min-w-[130px] text-xs"
              >
                <option value="">{t("students.allFields", "All fields")}</option>
                {fields
                  ?.filter((f) => !levelId || f.level_id === levelId)
                  .map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {STATUSES.map((option) => (
                <button
                  key={option.value || "all"}
                  type="button"
                  onClick={() => setStatus(option.value)}
                  aria-pressed={status === option.value}
                  className={cn("btn text-xs", status === option.value ? "btn-primary" : "btn-secondary")}
                >
                  {t(option.label)}
                </button>
              ))}
              {hasFilters && (
                <button type="button" onClick={clearFilters} className="btn btn-secondary text-xs">
                  {t("students.clearFilters", "Effacer les filtres")}
                </button>
              )}
            </div>
          </div>

          {totals && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SummaryTile
                label={t("financial.payroll.alreadyPaid", "Déjà versé")}
                value={formatCurrency(totals.paid)}
                tone="positive"
              />
              <SummaryTile
                label={t("financial.payroll.outstanding", "Reste à verser")}
                value={formatCurrency(totals.balance)}
                tone={Number(totals.balance) > 0 ? "danger" : "neutral"}
              />
            </div>
          )}

          {isLoading ? (
            <FinancialTableSkeleton />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<UserCheck size={24} />}
              message={t("financial.noProfessors", "Aucun professeur ne correspond à ces filtres.")}
              actionLabel={hasFilters ? t("students.clearFilters", "Effacer les filtres") : undefined}
              onAction={hasFilters ? clearFilters : undefined}
            />
          ) : (
            <div className={cn("overflow-hidden rounded-table border border-border shadow-card", isFetching && "opacity-70")}>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-background">
                      <Th>{t("nav.professors", "Professeur")}</Th>
                      <Th>{t("payments.structure", "Niveau / Filière")}</Th>
                      <Th right>{t("nav.students", "Étudiants")}</Th>
                      <Th right>{t("financial.payroll.paid", "Versé")}</Th>
                      <Th right title={t("financial.payroll.restHint")}>
                        {t("financial.payroll.remainingBalance", "Reste")}
                      </Th>
                      <Th>{t("payments.status", "Statut")}</Th>
                      <Th right aria-hidden="true" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((row) => (
                      <ProfessorRow
                        key={row.professor.id}
                        row={row}
                        onOpen={() => router.push(`/financial/professors/${row.professor.id}?period=${row.period}`)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Th({ children, right, title }: { children?: React.ReactNode; right?: boolean; title?: string }) {
  return (
    <th
      title={title}
      className={cn(
        "px-3 py-2.5 text-left text-xs font-semibold text-text-secondary uppercase whitespace-nowrap",
        right && "text-right",
      )}
    >
      {children}
    </th>
  );
}

function ProfessorRow({ row, onOpen }: { row: PayrollRow; onOpen: () => void }) {
  const { t } = useTranslation();
  const level = row.professor.level?.name;
  const field = row.professor.field?.name;

  return (
    <tr onClick={onOpen} className="hover:bg-background/50 cursor-pointer transition-colors">
      <td className="px-3 py-2.5">
        <Link
          href={`/financial/professors/${row.professor.id}?period=${row.period}`}
          onClick={(e) => e.stopPropagation()}
          className="text-primary hover:underline font-medium"
        >
          {row.professor.full_name}
        </Link>
        <span className="block text-xs text-text-secondary mt-0.5">
          {t(`financial.models.${row.model}`, row.model.replace(/_/g, " "))}
        </span>
      </td>
      <td className="px-3 py-2.5 text-text-secondary text-xs">
        {level && field ? `${level} · ${field}` : (level ?? field ?? "—")}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{row.student_count}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-success-strong">{formatCurrency(row.already_paid)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {Number(row.remaining_balance) > 0 ? (
          <span className="text-danger-strong font-medium">{formatCurrency(row.remaining_balance)}</span>
        ) : (
          <span className="text-text-secondary">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
            payrollStatusClasses(row.status),
          )}
        >
          {t(`financial.payroll.${row.status}`, row.status)}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <ChevronRight size={15} className="text-text-tertiary ml-auto" aria-hidden="true" />
      </td>
    </tr>
  );
}
