"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, History, Receipt, Search } from "lucide-react";
import { FinancialFilterBar } from "@/components/financial/financial-filters";
import { ErrorState } from "@/components/financial/error-state";
import { useFinancialActivity, useLedger } from "@/hooks/use-financial";
import { FinancialTableSkeleton } from "@/components/shared/skeletons";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { EmptyState } from "@/components/shared/empty-state";
import type { FinancialFilters } from "@/lib/api/financial.api";
import { cn, formatCurrency, formatDate } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";

type Tab = "ledger" | "activity";

/**
 * Transaction History — two records, deliberately kept apart.
 *
 * The **ledger** is what money did: every payment, refund and correction with
 * the split that was applied. The **activity trail** is what people did, drawn
 * from the audit log — including the actions that move no money but change what
 * money means, like a percentage being edited. Merging them would produce a feed
 * where a settings change and a 40 DT payment sit in one list with no way to
 * total either.
 */
export default function TransactionsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("ledger");
  const [filters, setFilters] = useState<FinancialFilters>({ range: "this_month" });
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebouncedValue(search, 300);

  const ledgerQuery = useMemo(
    () => ({ ...filters, type: type || undefined, search: debouncedSearch || undefined, page, pageLimit: 50 }),
    [filters, type, debouncedSearch, page],
  );

  const activityQuery = useMemo(
    () => ({ from: filters.from, to: filters.to, search: debouncedSearch || undefined, page, limit: 50 }),
    [filters.from, filters.to, debouncedSearch, page],
  );

  /** Each tab owns its query: the other one stays disabled until shown. */
  const { data: ledger, isLoading: ledgerLoading, isError: ledgerError, refetch: refetchLedger } = useLedger(
    ledgerQuery,
    tab === "ledger",
  );
  const { data: activity, isLoading: activityLoading, isError: activityError, refetch: refetchActivity } =
    useFinancialActivity(activityQuery, tab === "activity");

  const isLoading = tab === "ledger" ? ledgerLoading : activityLoading;
  const meta = tab === "ledger" ? ledger?.meta : activity?.meta;
  const refetch = tab === "ledger" ? refetchLedger : refetchActivity;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-h2 font-bold text-text-primary mb-1">{t("financial.transactions", "Transactions")}</h1>
        <p className="text-sm text-text-secondary">
          {t("financial.transactionsSub", "Grand livre des mouvements et historique d'activité")}
        </p>
      </div>
      <div className="flex items-center gap-1 border-b border-border -mb-px">
        {(
          [
            { value: "ledger" as Tab, label: t("financial.ledger", "Ledger"), icon: Receipt },
            { value: "activity" as Tab, label: t("financial.activityTrail", "Activity trail"), icon: History },
          ]
        ).map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setTab(option.value);
                setPage(1);
              }}
              aria-current={tab === option.value ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors",
                tab === option.value
                  ? "border-primary text-primary"
                  : "border-transparent text-text-secondary hover:text-text-primary",
              )}
            >
              <Icon size={15} aria-hidden="true" />
              {option.label}
            </button>
          );
        })}
      </div>

      <FinancialFilterBar
        value={filters}
        onChange={(next) => {
          setFilters(next);
          setPage(1);
        }}
        showGranularity={false}
        showAcademic={tab === "ledger"}
      />

      <div className="card flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
          <input
            type="text"
            placeholder={t("financial.searchTransactions", "Search receipt, student or reason…")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="input pl-9 w-full text-xs"
          />
        </div>
        {tab === "ledger" &&
          [
            { value: "", label: "payments.all" },
            { value: "payment", label: "financial.txn.payment" },
            { value: "refund", label: "financial.txn.refund" },
            { value: "correction", label: "financial.txn.correction" },
          ].map((option) => (
            <button
              key={option.value || "all"}
              type="button"
              onClick={() => {
                setType(option.value);
                setPage(1);
              }}
              aria-pressed={type === option.value}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                type === option.value
                  ? "bg-surface text-text-primary border-border shadow-dropdown font-semibold"
                  : "border-transparent text-text-secondary hover:bg-black/[0.04] hover:text-text-primary dark:hover:bg-white/[0.06]",
              )}
            >
              {t(option.label)}
            </button>
          ))}
      </div>

      {tab === "ledger" && ledger?.meta.totals && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Tile label={t("financial.netCollected", "Net collected")} value={formatCurrency(ledger.meta.totals.amount)} />
          <Tile label={t("financial.professorShare", "Professor share")} value={formatCurrency(ledger.meta.totals.professor_share)} />
          <Tile label={t("financial.schoolShare", "School share")} value={formatCurrency(ledger.meta.totals.school_share)} tone="positive" />
        </div>
      )}

      {(tab === "ledger" ? ledgerError : activityError) ? (
        <ErrorState onRetry={refetch} />
      ) : isLoading ? (
        <FinancialTableSkeleton />
      ) : tab === "ledger" ? (
        (ledger?.data.length ?? 0) === 0 ? (
          <EmptyState message={t("financial.noTransactions", "No transactions in this window.")} />
        ) : (
          <div className="overflow-hidden rounded-table border border-border shadow-card">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-background">
                    <Th>{t("payments.dueDate", "Date")}</Th>
                    <Th>{t("financial.receiptNumber", "Receipt")}</Th>
                    <Th>{t("financial.type", "Type")}</Th>
                    <Th>{t("payments.studentName", "Student")}</Th>
                    <Th>{t("nav.professors", "Professor")}</Th>
                    <Th>{t("payments.period", "Period")}</Th>
                    <Th>{t("financial.reason", "Reason")}</Th>
                    <Th right>{t("payments.amount", "Amount")}</Th>
                    <Th right>{t("financial.professorShare", "Professor")}</Th>
                    <Th right>{t("financial.schoolShare", "School")}</Th>
                    <Th>{t("financial.recordedBy", "Recorded by")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ledger!.data.map((row) => (
                    <tr key={row.id} className="hover:bg-background/50">
                      <td className="timeline-cell pl-7 px-3 py-2.5 text-text-secondary whitespace-nowrap">
                        <span aria-hidden="true" className="timeline-stem" />
                        <span aria-hidden="true" className="timeline-dot" />
                        {formatDate(row.paid_at)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-text-secondary">{row.receipt_number ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                            row.type === "refund"
                              ? "bg-danger-soft text-danger-strong border-danger/30"
                              : row.type === "correction"
                                ? "bg-gold-50 text-gold-700 border-gold-200"
                                : "bg-success-soft text-success-strong border-success/30",
                          )}
                        >
                          {t(`financial.txn.${row.type}`, row.type)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-text-primary">{row.student?.name ?? "—"}</td>
                      <td className="px-3 py-2.5 text-text-secondary">{row.professor?.name ?? "—"}</td>
                      <td className="px-3 py-2.5 text-text-secondary">{row.period}</td>
                      <td className="px-3 py-2.5 text-text-secondary max-w-[200px] truncate" title={row.reason ?? ""}>
                        {row.reason ?? "—"}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right tabular-nums font-medium",
                          Number(row.amount) < 0 ? "text-danger-strong" : "text-text-primary",
                        )}
                      >
                        {formatCurrency(row.amount)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                        {formatCurrency(row.professor_share)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                        {formatCurrency(row.school_share)}
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">{row.recorded_by?.name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : (activity?.data.length ?? 0) === 0 ? (
        <EmptyState message={t("financial.noActivity", "No financial activity in this window.")} />
      ) : (
        <div className="overflow-hidden rounded-table border border-border shadow-card">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <Th>{t("audit.timestamp", "Timestamp")}</Th>
                  <Th>{t("audit.actor", "User")}</Th>
                  <Th>{t("audit.action", "Action")}</Th>
                  <Th>{t("audit.entity", "Target")}</Th>
                  <Th>{t("audit.changes", "Old → New")}</Th>
                  <Th>{t("audit.ip", "IP")}</Th>
                </tr>
              </thead>
<tbody className="divide-y divide-border">
                  {activity!.data.map((log: any) => (
                    <tr key={log.id} className="hover:bg-background/50 align-top">
                    <td className="timeline-cell pl-7 px-3 py-2.5 text-text-secondary whitespace-nowrap">
                      <span aria-hidden="true" className="timeline-stem" />
                      <span aria-hidden="true" className="timeline-dot" />
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-text-primary">
                      {log.actor?.full_name ?? log.actor_label ?? "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <code className="text-xs bg-background px-1.5 py-0.5 rounded">{log.action}</code>
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary">{log.entity_label ?? log.entity_type}</td>
                    <td className="px-3 py-2.5 text-xs text-text-secondary max-w-[280px]">
                      <ChangeSummary prev={log.prev_values} next={log.new_values} />
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary font-mono text-xs">{log.ip_address ?? "—"}</td>
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
            {meta.total}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={meta.page <= 1}
              className="btn btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
            >
              <ChevronLeft size={14} aria-hidden="true" />
              {t("common.previous", "Previous")}
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={meta.page >= meta.totalPages}
              className="btn btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
            >
              {t("common.next", "Next")}
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Renders only the keys that actually changed — a full JSON dump is unreadable. */
function ChangeSummary({
  prev,
  next,
}: {
  prev: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
}) {
  const { t } = useTranslation();
  if (!prev && !next) return <span>—</span>;

  const keys = Array.from(new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})]));
  const changed = keys.filter((key) => String(prev?.[key] ?? "") !== String(next?.[key] ?? ""));

  if (changed.length === 0) return <span>—</span>;

  return (
    <ul className="space-y-0.5">
      {changed.slice(0, 4).map((key) => (
        <li key={key}>
          <span className="text-text-secondary">{key}: </span>
          {prev?.[key] !== undefined && (
            <span className="line-through text-danger-strong">{String(prev[key])}</span>
          )}
          {prev?.[key] !== undefined && next?.[key] !== undefined && <span> → </span>}
          {next?.[key] !== undefined && <span className="text-success-strong">{String(next[key])}</span>}
        </li>
      ))}
      {changed.length > 4 && <li className="text-text-secondary">{t("financial.moreChanges").replace("{count}", String(changed.length - 4))}</li>}
    </ul>
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

function Tile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive";
}) {
  return (
    <div className="card py-3">
      <p className="text-xs text-text-secondary">{label}</p>
      <p
        className={cn(
          "text-h4 font-bold tabular-nums mt-0.5",
          tone === "positive" ? "text-success-strong" : "text-text-primary",
        )}
      >
        {value}
      </p>
    </div>
  );
}
