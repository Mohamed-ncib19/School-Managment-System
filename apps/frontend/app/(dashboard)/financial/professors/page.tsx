"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Wallet } from "lucide-react";
import { usePayroll } from "@/hooks/use-financial";
import { useFields, useLevels } from "@/hooks/use-queries";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { EmptyState } from "@/components/shared/empty-state";
import { FinancialTableSkeleton, PageLoader } from "@/components/shared/skeletons";
import { payrollStatusClasses } from "@/lib/charts/theme";
import { cn, formatCurrency } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";

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

  const { data, isLoading } = usePayroll(query);
  const rows = data?.data ?? [];
  const totals = data?.meta?.totals;

  return (
    <div className="space-y-4">
      <div className="card flex items-center gap-3 flex-wrap">
        <input
          type="month"
          aria-label={t("payments.period", "Period")}
          value={period}
          onChange={(e) => setPeriod(e.target.value || currentPeriod())}
          className="input w-auto text-xs"
        />
        <div className="relative flex-1 min-w-[180px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
          <input
            type="text"
            placeholder={t("financial.searchProfessors", "Search professors…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9 w-full text-xs"
          />
        </div>
        <select
          aria-label={t("nav.levels", "Levels")}
          value={levelId}
          onChange={(e) => { setLevelId(e.target.value); setFieldId(""); }}
          className="input w-auto min-w-[130px] text-xs"
        >
          <option value="">{t("students.allLevels", "All levels")}</option>
          {levels?.map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}
        </select>
        <select
          aria-label={t("nav.fields", "Fields")}
          value={fieldId}
          onChange={(e) => setFieldId(e.target.value)}
          className="input w-auto min-w-[130px] text-xs"
        >
          <option value="">{t("students.allFields", "All fields")}</option>
          {fields?.filter((f) => !levelId || f.level_id === levelId).map((field) => (
            <option key={field.id} value={field.id}>{field.name}</option>
          ))}
        </select>
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
      </div>

      {totals && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Tile label={t("financial.payroll.totalEarned", "Total earned")} value={formatCurrency(totals.earned)} />
          <Tile label={t("financial.payroll.alreadyPaid", "Already paid")} value={formatCurrency(totals.paid)} tone="positive" />
          <Tile label={t("financial.payroll.outstanding", "Outstanding")} value={formatCurrency(totals.balance)} tone="danger" />
        </div>
      )}

      {isLoading ? (
        <PageLoader text={t("common.loading", "Loading…")} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Wallet size={24} />}
          message={t("financial.noProfessors", "No professors match these filters.")}
        />
      ) : (
        <div className="overflow-hidden rounded-table border border-border shadow-card">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-secondary uppercase">
                    {t("nav.professors", "Professor")}
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-secondary uppercase">
                    {t("nav.levels", "Level")}
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-secondary uppercase">
                    {t("nav.fields", "Field")}
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-secondary uppercase">
                    {t("financial.model", "Model")}
                  </th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-secondary uppercase">
                    {t("nav.students", "Students")}
                  </th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-secondary uppercase">
                    {t("financial.payroll.earned", "Earned")}
                  </th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-secondary uppercase">
                    {t("financial.payroll.paid", "Paid")}
                  </th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-text-secondary uppercase">
                    {t("financial.remainingBalance", "Balance")}
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-secondary uppercase">
                    {t("payments.status", "Status")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.professor.id} className="hover:bg-background/50 transition-colors">
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/financial/professors/${row.professor.id}?period=${row.period}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {row.professor.full_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary">{row.professor.level?.name ?? "—"}</td>
                    <td className="px-3 py-2.5 text-text-secondary">{row.professor.field?.name ?? "—"}</td>
                    <td className="px-3 py-2.5 text-text-secondary text-xs">
                      {t(`financial.models.${row.model}`, row.model.replace(/_/g, " "))}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{row.student_count}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                      {formatCurrency(row.total_earned)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-success-strong">
                      {formatCurrency(row.already_paid)}
                    </td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "danger";
}) {
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
    </div>
  );
}
