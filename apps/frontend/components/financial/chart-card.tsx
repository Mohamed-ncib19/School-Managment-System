"use client";

import { useState, type ReactNode } from "react";
import { BarChart3, Table2, Inbox } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  series: ChartSeries[];
  /** The rows behind the chart — powers the table view. */
  tableRows?: Record<string, unknown>[];
  /** The column shown first in the table view (usually the bucket or name). */
  labelKey?: string;
  labelHeader?: string;
  /** Table columns that should be rendered as currency rather than raw text. */
  currencyKeys?: string[];
  actions?: ReactNode;
  loading?: boolean;
  isEmpty?: boolean;
  emptyMessage?: string;
  /**
   * Suppresses the legend for charts that label their marks directly — a donut
   * with a labelled list beside it would otherwise name every slice twice.
   * `series` is still required, because the table view is built from it.
   */
  hideLegend?: boolean;
  children: ReactNode;
}

/**
 * The frame every chart sits in: title, legend, and a table view.
 *
 * The table is not a nicety. Two of the light-mode palette slots sit below 3:1
 * against the surface, and the documented relief for that is visible labels or
 * a table — so a chart in this product always ships an equivalent that does not
 * depend on telling colours apart. It also gives anyone who wants the actual
 * numbers somewhere to get them.
 *
 * A legend is always present for two or more series, so identity is never
 * carried by colour alone. A single-series chart gets none — the title names it.
 */
export function ChartCard({
  title,
  subtitle,
  series,
  tableRows,
  labelKey = "bucket",
  labelHeader,
  currencyKeys,
  actions,
  loading,
  isEmpty,
  emptyMessage,
  hideLegend,
  children,
}: ChartCardProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<"chart" | "table">("chart");
  const canShowTable = Boolean(tableRows && tableRows.length > 0);
  const money = new Set(currencyKeys ?? series.map((s) => s.key));

  return (
    <div className="card flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-text-primary">{title}</h3>
          {subtitle && <p className="text-xs text-text-secondary mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {canShowTable && (
            <div className="flex items-center rounded-btn border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setView("chart")}
                aria-pressed={view === "chart"}
                aria-label={t("financial.chartView", "Vue graphique")}
                className={cn(
                  "px-2 py-1.5 transition-colors",
                  view === "chart" ? "bg-primary text-white" : "text-text-secondary hover:bg-background",
                )}
              >
                <BarChart3 size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setView("table")}
                aria-pressed={view === "table"}
                aria-label={t("financial.tableView", "Vue tableau")}
                className={cn(
                  "px-2 py-1.5 transition-colors",
                  view === "table" ? "bg-primary text-white" : "text-text-secondary hover:bg-background",
                )}
              >
                <Table2 size={14} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Legend for two or more series — identity never rests on colour alone. */}
      {series.length > 1 && !hideLegend && (
        <div className="flex items-center gap-4 flex-wrap -mt-1">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </span>
          ))}
        </div>
      )}

      <div className="border-t border-border pt-4">
        {loading ? (
          <div className="h-64 rounded-card bg-neutral-soft animate-pulse" />
        ) : isEmpty ? (
          <div className="h-64 flex flex-col items-center justify-center gap-2 text-sm text-text-secondary">
            <Inbox size={28} strokeWidth={1.5} className="text-text-tertiary" aria-hidden="true" />
            {emptyMessage ?? t("financial.noDataForFilters", "Aucune donnée pour les filtres sélectionnés.")}
          </div>
        ) : view === "chart" ? (
          children
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary uppercase">
                    {labelHeader ?? t("financial.period", "Période")}
                  </th>
                  {series.map((s) => (
                    <th
                      key={s.key}
                      className="px-3 py-2 text-right text-xs font-semibold text-text-secondary uppercase"
                    >
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tableRows!.map((row, index) => (
                  <tr key={index} className="hover:bg-background/50">
                    <td className="px-3 py-2 text-text-primary">{String(row[labelKey] ?? "—")}</td>
                    {series.map((s) => (
                      <td key={s.key} className="px-3 py-2 text-right tabular-nums text-text-secondary">
                        {money.has(s.key)
                          ? formatCurrency(String(row[s.key] ?? "0"))
                          : String(row[s.key] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
