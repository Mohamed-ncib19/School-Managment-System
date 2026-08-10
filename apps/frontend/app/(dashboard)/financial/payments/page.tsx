"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, Printer, RefreshCw, Search } from "lucide-react";
import {
  useFinancialPayments,
  useGenerateMonthlyInvoices,
  useRefreshPaymentStatuses,
} from "@/hooks/use-financial";
import { useFields, useGroups, useLevels, useProfessors, useStudentSearch } from "@/hooks/use-queries";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { PaymentActionsModal } from "@/components/financial/payment-actions-modal";
import { ErrorState } from "@/components/financial/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { FinancialTableSkeleton, PageLoader } from "@/components/shared/skeletons";
import { openReceipt } from "@/lib/api/financial.api";
import { statusClasses } from "@/lib/charts/theme";
import { cn, formatCurrency, formatDate, formatPeriod } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";
import type { PaymentStatus, StudentPayment } from "@/types";

const STATUSES: { value: string; label: string }[] = [
  { value: "", label: "payments.all" },
  { value: "not_paid", label: "payments.statuses.not_paid" },
  { value: "due_soon", label: "payments.statuses.due_soon" },
  { value: "overdue", label: "payments.statuses.overdue" },
  { value: "partially_paid", label: "payments.statuses.partially_paid" },
  { value: "paid", label: "payments.statuses.paid" },
  { value: "cancelled", label: "payments.statuses.cancelled" },
];

const QUICK: { value: string; label: string; apply: () => Record<string, string> }[] = [
  {
    value: "today",
    label: "financial.today",
    apply: () => {
      const today = new Date().toISOString().slice(0, 10);
      return { from: today, to: today };
    },
  },
  {
    value: "this_month",
    label: "financial.thisMonth",
    apply: () => {
      const now = new Date();
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
      return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
    },
  },
  {
    value: "last_month",
    label: "financial.lastMonth",
    apply: () => {
      const now = new Date();
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
      return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
    },
  },
];

/**
 * Student Payments — the screen that replaces `/payments`.
 *
 * Filtering, sorting, totals and pagination all happen server-side. The footer
 * total spans the whole filtered set rather than the visible page, because a
 * total that silently means "this page only" is worse than no total.
 */
export default function StudentPaymentsPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <StudentPaymentsInner />
    </Suspense>
  );
}

function StudentPaymentsInner() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();

  /**
   * The dashboard's KPI cards deep-link here with a status (`?status=not_paid`,
   * `?status=overdue`). Read it once on mount so those links land on the right
   * chip; everything else the user does stays in-memory.
   */
  const [status, setStatus] = useState(() => searchParams.get("status") ?? "");
  const [levelId, setLevelId] = useState("");
  const [fieldId, setFieldId] = useState("");
  const [profId, setProfId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [period, setPeriod] = useState("");
  const [dates, setDates] = useState<{ from?: string; to?: string }>({});
  const [receiptNumber, setReceiptNumber] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [months, setMonths] = useState("0");
  const [selected, setSelected] = useState<StudentPayment | null>(null);

  const debouncedSearch = useDebouncedValue(search, 300);
  const debouncedReceipt = useDebouncedValue(receiptNumber, 300);

  /**
   * While a student is being searched, every hierarchy dropdown below only
   * offers the entities the matched students actually belong to — one field
   * searched, one field in the list, and only its child groups selectable.
   */
  const { data: matchedStudents } = useStudentSearch(debouncedSearch);
  const scoped = useMemo(() => {
    const levels = new Set<string>();
    const fields = new Set<string>();
    const professors = new Set<string>();
    const groups = new Set<string>();
    for (const student of matchedStudents ?? []) {
      const chains = student.group ? [student.group, ...(student.assignments ?? []).map((a) => a.group).filter(Boolean)] : [];
      for (const chain of chains) {
        if (!chain) continue;
        groups.add(chain.id);
        const professor = chain.professor;
        if (professor) {
          professors.add(professor.id);
          const field = professor.field;
          if (field) {
            fields.add(field.id);
            if (field.level) levels.add(field.level.id);
          }
        }
      }
    }
    return { levels, fields, professors, groups };
  }, [matchedStudents]);

  const query = useMemo(
    () => ({
      status: status || undefined,
      levelId: levelId || undefined,
      fieldId: fieldId || undefined,
      profId: profId || undefined,
      groupId: groupId || undefined,
      period: period || undefined,
      from: dates.from,
      to: dates.to,
      receiptNumber: debouncedReceipt || undefined,
      search: debouncedSearch || undefined,
      page,
      limit: 50,
    }),
    [status, levelId, fieldId, profId, groupId, period, dates, debouncedReceipt, debouncedSearch, page],
  );

  const { data, isLoading, isFetching, isError, refetch } = useFinancialPayments(query);
  const { data: levels } = useLevels();
  const { data: fields } = useFields();
  const { data: professors } = useProfessors(fieldId || undefined);
  const { data: groups } = useGroups(profId || undefined);

  const generate = useGenerateMonthlyInvoices();
  const refresh = useRefreshPaymentStatuses();

  const rows = data?.data ?? [];
  const meta = data?.meta;

  const resetTo = (patch: () => void) => {
    patch();
    setPage(1);
  };

  const clearAll = () => {
    setStatus("");
    setLevelId("");
    setFieldId("");
    setProfId("");
    setGroupId("");
    setPeriod("");
    setDates({});
    setReceiptNumber("");
    setSearch("");
    setPage(1);
  };

  const hasFilters =
    status || levelId || fieldId || profId || groupId || period || dates.from || dates.to || receiptNumber || search;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => refresh.mutate(undefined)}
          disabled={refresh.isPending}
          className="btn btn-secondary text-xs"
        >
          <RefreshCw size={14} className={cn(refresh.isPending && "animate-spin")} aria-hidden="true" />
          {t("financial.refreshStatuses", "Refresh statuses")}
        </button>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            {t("payments.monthsAhead", "Months")}
            <input
              type="number"
              min={0}
              max={12}
              value={months}
              onChange={(e) => setMonths(e.target.value)}
              className="input w-16 text-xs tabular-nums"
              title={t("payments.monthsAhead", "Months")}
            />
          </label>
          <button
            type="button"
            onClick={() => generate.mutate(parseInt(months, 10) || 0)}
            disabled={generate.isPending}
            className="btn btn-primary text-xs"
          >
            {generate.isPending ? (
              <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus size={14} aria-hidden="true" />
            )}
            {t("payments.generateMonths", "Generate invoices")}
          </button>
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
            <input
              type="text"
              placeholder={t("financial.searchPayments", "Search student or receipt…")}
              value={search}
              onChange={(e) => resetTo(() => setSearch(e.target.value))}
              className="input pl-9 w-full text-xs"
            />
          </div>
          <input
            type="text"
            placeholder={t("financial.receiptNumber", "Receipt no.")}
            value={receiptNumber}
            onChange={(e) => resetTo(() => setReceiptNumber(e.target.value))}
            className="input w-auto min-w-[130px] text-xs"
          />
          <input
            type="month"
            aria-label={t("payments.period", "Period")}
            value={period}
            onChange={(e) => resetTo(() => setPeriod(e.target.value))}
            className="input w-auto text-xs"
          />
          <input
            type="date"
            aria-label={t("financial.from", "From")}
            value={dates.from ?? ""}
            onChange={(e) => resetTo(() => setDates((d) => ({ ...d, from: e.target.value || undefined })))}
            className="input w-auto text-xs"
          />
          <input
            type="date"
            aria-label={t("financial.to", "To")}
            value={dates.to ?? ""}
            onChange={(e) => resetTo(() => setDates((d) => ({ ...d, to: e.target.value || undefined })))}
            className="input w-auto text-xs"
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <select
            aria-label={t("nav.levels", "Levels")}
            value={levelId}
            onChange={(e) => resetTo(() => { setLevelId(e.target.value); setFieldId(""); setProfId(""); setGroupId(""); })}
            className="input w-auto min-w-[130px] text-xs"
          >
            <option value="">{t("students.allLevels", "All levels")}</option>
            {levels
              ?.filter((level) => !scoped.levels.size || scoped.levels.has(level.id))
              .map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}
          </select>
          <select
            aria-label={t("nav.fields", "Fields")}
            value={fieldId}
            onChange={(e) => resetTo(() => { setFieldId(e.target.value); setProfId(""); setGroupId(""); })}
            className="input w-auto min-w-[130px] text-xs"
          >
            <option value="">{t("students.allFields", "All fields")}</option>
            {fields
              ?.filter((f) => (!levelId || f.level_id === levelId) && (!scoped.fields.size || scoped.fields.has(f.id)))
              .map((field) => (
                <option key={field.id} value={field.id}>{field.name}</option>
              ))}
          </select>
          <select
            aria-label={t("nav.professors", "Professors")}
            value={profId}
            onChange={(e) => resetTo(() => { setProfId(e.target.value); setGroupId(""); })}
            disabled={!fieldId}
            className="input w-auto min-w-[140px] text-xs disabled:opacity-50"
          >
            <option value="">{t("students.allProfessors", "All professors")}</option>
            {professors
              ?.filter((p) => !scoped.professors.size || scoped.professors.has(p.id))
              .map((professor) => (
                <option key={professor.id} value={professor.id}>{professor.full_name}</option>
              ))}
          </select>
          <select
            aria-label={t("nav.groups", "Groups")}
            value={groupId}
            onChange={(e) => resetTo(() => setGroupId(e.target.value))}
            disabled={!profId}
            className="input w-auto min-w-[130px] text-xs disabled:opacity-50"
          >
            <option value="">{t("students.allGroups", "All groups")}</option>
            {groups
              ?.filter((g) => !scoped.groups.size || scoped.groups.has(g.id))
              .map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>

          {QUICK.map((quick) => (
            <button
              key={quick.value}
              type="button"
              onClick={() => resetTo(() => setDates(quick.apply()))}
              className="btn btn-secondary text-xs"
            >
              {t(quick.label)}
            </button>
          ))}

          {hasFilters && (
            <button type="button" onClick={clearAll} className="btn btn-secondary text-xs">
              {t("students.clearFilters", "Clear")}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {STATUSES.map((option) => (
            <button
              key={option.value || "all"}
              type="button"
              onClick={() => resetTo(() => setStatus(option.value))}
              aria-pressed={status === option.value}
              className={cn("btn text-xs", status === option.value ? "btn-primary" : "btn-secondary")}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
      </div>

      {meta && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SummaryTile label={t("payments.amountDue", "Total due")} value={formatCurrency(meta.totals.amount_due)} />
          <SummaryTile
            label={t("financial.collected", "Collected")}
            value={formatCurrency(meta.totals.paid_amount)}
            tone="positive"
          />
          <SummaryTile
            label={t("financial.outstanding", "Outstanding")}
            value={formatCurrency(meta.totals.outstanding)}
            tone="danger"
          />
        </div>
      )}

      {isError ? (
        <ErrorState
          title={t("financial.paymentsLoadError", "Couldn't load payments.")}
          hint={t("financial.paymentsLoadErrorHint", "The server may be busy or unreachable. Make sure the backend is running, then retry.")}
          retryLabel={t("financial.retry", "Retry")}
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <FinancialTableSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState message={t("payments.noPaymentsYet", "No payments match these filters.")} />
      ) : (
        <div className={cn("overflow-hidden rounded-table border border-border shadow-card", isFetching && "opacity-70")}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <Th>{t("payments.studentName", "Student")}</Th>
                  <Th>{t("payments.structure", "Level / Field")}</Th>
                  <Th>{t("payments.assignment", "Professor / Group")}</Th>
                  <Th>{t("payments.period", "Period")}</Th>
                  <Th>{t("payments.dueDate", "Due")}</Th>
                  <Th>{t("financial.receiptNumber", "Receipt")}</Th>
                  <Th>{t("payments.status", "Status")}</Th>
                  <Th right>{t("payments.amountDue", "Due")}</Th>
                  <Th right>{t("payments.paidAmount", "Paid")}</Th>
                  <Th right>{t("financial.remainingBalance", "Balance")}</Th>
                  <Th right>{t("payments.actions", "Actions")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((payment) => (
                  <tr key={payment.id} className="hover:bg-background/50 transition-colors">
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/students/${payment.student_id}/payments`}
                        className="text-primary hover:underline font-medium"
                      >
                        {payment.context.student_name ?? "—"}
                      </Link>
                    </td>
                     <td className="px-3 py-2.5 text-text-secondary">
                       <div className="flex flex-col gap-1">
                         <div className="flex flex-wrap gap-1">
                           {(payment.context.levels?.length ? payment.context.levels : payment.context.level ? [payment.context.level] : []).map((lv) => (
                             <span key={lv.id} className="inline-flex items-center rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-text-secondary whitespace-nowrap">
                               {lv.name}
                             </span>
                           ))}
                         </div>
                         <div className="flex flex-wrap gap-1">
                           {(payment.context.fields?.length ? payment.context.fields : payment.context.field ? [payment.context.field] : []).map((f) => (
                             <span key={f.id} className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-text-secondary whitespace-nowrap">
                               {f.color && <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: f.color }} />}
                               {f.name}
                             </span>
                           ))}
                         </div>
                       </div>
                     </td>
                     <td className="px-3 py-2.5 text-text-secondary">
                       <div className="flex flex-col gap-1">
                         <div className="flex flex-wrap gap-1">
                           {(payment.context.professors?.length ? payment.context.professors : payment.context.professor ? [payment.context.professor] : []).map((p) => (
                             <span key={p.id} className="inline-flex items-center rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-text-secondary whitespace-nowrap">
                               {p.color && <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />}
                               {p.name}
                             </span>
                           ))}
                         </div>
                         <div className="flex flex-wrap gap-1">
                           {(payment.context.groups?.length ? payment.context.groups : payment.context.group ? [payment.context.group] : []).map((g) => (
                             <span key={g.id} className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-text-secondary whitespace-nowrap">
                               {g.color && <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: g.color }} />}
                               {g.name}
                             </span>
                           ))}
                         </div>
                       </div>
                     </td>
                    <td className="px-3 py-2.5 text-text-secondary">{formatPeriod(payment.period)}</td>
                    <td className="px-3 py-2.5 text-text-secondary">{formatDate(payment.due_date)}</td>
                    <td className="px-3 py-2.5 text-text-secondary font-mono text-xs">
                      {payment.receipt_number ?? "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                          statusClasses(payment.status),
                        )}
                      >
                        {t(`payments.statuses.${payment.status}`, payment.status.replace(/_/g, " "))}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(payment.amount_due)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-success-strong">
                      {payment.paid_amount ? formatCurrency(payment.paid_amount) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {Number(payment.remaining_balance) > 0 ? (
                        <span className="text-danger-strong">{formatCurrency(payment.remaining_balance)}</span>
                      ) : (
                        <span className="text-text-secondary">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {payment.transactions.length > 0 && (
                          <button
                            type="button"
                            onClick={() => openReceipt("payment", payment.id).catch(() => {})}
                            aria-label={t("financial.printReceipt", "Print receipt")}
                            className="btn btn-secondary text-xs"
                          >
                            <Printer size={13} aria-hidden="true" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelected(payment)}
                          className="btn btn-secondary text-xs whitespace-nowrap"
                        >
                          {t("financial.manage", "Manage")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-secondary">
            {t("common.pageOf", "Page {page} of {total}")
              .replace("{page}", String(meta.page))
              .replace("{total}", String(meta.totalPages))}
            {" · "}
            {meta.total} {t("financial.invoices", "invoices")}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={meta.page <= 1}
              className="btn btn-secondary text-xs disabled:opacity-40"
            >
              <ChevronLeft size={14} aria-hidden="true" />
              {t("common.previous", "Previous")}
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={meta.page >= meta.totalPages}
              className="btn btn-secondary text-xs disabled:opacity-40"
            >
              {t("common.next", "Next")}
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {selected && (
        <PaymentActionsModal
          payment={rows.find((row) => row.id === selected.id) ?? selected}
          isOpen={!!selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={cn(
        "px-3 py-2.5 text-xs font-semibold text-text-secondary uppercase whitespace-nowrap",
        right ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function SummaryTile({
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
