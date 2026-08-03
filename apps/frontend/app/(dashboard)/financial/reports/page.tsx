"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { FinancialFilterBar } from "@/components/financial/financial-filters";
import { useReport } from "@/hooks/use-financial";
import { FinancialTableSkeleton, PageLoader } from "@/components/shared/skeletons";
import { downloadReport, openReportDocument } from "@/lib/api/financial.api";
import type { FinancialFilters } from "@/lib/api/financial.api";
import { cn, formatCurrency } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";

const REPORTS = [
  { value: "collections", label: "financial.reports.collections" },
  { value: "outstanding", label: "financial.reports.outstanding" },
  { value: "professor_payroll", label: "financial.reports.payroll" },
  { value: "school_revenue", label: "financial.reports.schoolRevenue" },
  { value: "revenue_by_level", label: "financial.reports.byLevel" },
  { value: "revenue_by_professor", label: "financial.reports.byProfessor" },
  { value: "revenue_by_group", label: "financial.reports.byGroup" },
  { value: "revenue_forecast", label: "financial.reports.forecast" },
] as const;

/**
 * Financial Reports.
 *
 * The table on screen and the exported file are produced from the same server
 * response, so what is downloaded is exactly what was reviewed — a report that
 * re-queries on export is a report that can quietly disagree with itself.
 */
export default function FinancialReportsPage() {
  const { t } = useTranslation();
  const [type, setType] = useState<string>("collections");
  const [filters, setFilters] = useState<FinancialFilters>({
    granularity: "monthly",
    range: "academic_year",
  });
  const [exporting, setExporting] = useState<string | null>(null);

  const query = { ...filters, type };
  const { data: report, isLoading } = useReport(query);

  const handleExport = async (format: "pdf" | "excel" | "csv") => {
    setExporting(format);
    try {
      if (format === "pdf") {
        await openReportDocument(query);
      } else {
        await downloadReport({ ...query, format });
      }
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
          {t("financial.reports.reportType", "Report type")}
        </p>
        <div className="flex flex-wrap gap-2">
          {REPORTS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setType(option.value)}
              aria-pressed={type === option.value}
              className={cn(
                "btn text-xs min-w-[140px]",
                type === option.value ? "btn-primary" : "btn-secondary",
              )}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
      </div>

      <FinancialFilterBar value={filters} onChange={setFilters} />

      <div className="card">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <h3 className="text-sm font-bold text-text-primary">
              {report?.title ?? t("financial.nav.reports", "Reports")}
            </h3>
            {report && (
              <p className="text-xs text-text-secondary mt-0.5">
                {report.range.from.slice(0, 10)} &mdash; {report.range.to.slice(0, 10)} &middot;{" "}
                {report.rows.length} {t("financial.rows", "rows")} &middot; {report.currency}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleExport("csv")}
              disabled={!report || exporting !== null}
              className="btn btn-secondary text-xs disabled:opacity-40"
            >
              <Download size={13} aria-hidden="true" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => handleExport("excel")}
              disabled={!report || exporting !== null}
              className="btn btn-secondary text-xs disabled:opacity-40"
            >
              <FileSpreadsheet size={13} aria-hidden="true" />
              Excel
            </button>
            <button
              type="button"
              onClick={() => handleExport("pdf")}
              disabled={!report || exporting !== null}
              className="btn btn-secondary text-xs disabled:opacity-40"
            >
              <Printer size={13} aria-hidden="true" />
              PDF
            </button>
          </div>
        </div>

        {isLoading ? (
          <PageLoader text={t("common.loading", "Loading…")} />
        ) : !report || report.rows.length === 0 ? (
          <div className="py-16 text-center">
            <FileText size={28} className="mx-auto text-text-secondary mb-3" aria-hidden="true" />
            <p className="text-sm text-text-secondary">
              {t("financial.noDataForFilters", "No data for the selected filters.")}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-table border border-border">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-background">
                    {report.columns.map((column) => (
                      <th
                        key={column.key}
                        className={cn(
                          "px-3 py-2.5 text-xs font-semibold text-text-secondary uppercase whitespace-nowrap",
                          column.align === "right" || column.numeric ? "text-right" : "text-left",
                        )}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.rows.map((row, index) => (
                    <tr key={index} className="hover:bg-background/50">
                      {report.columns.map((column) => (
                        <td
                          key={column.key}
                          className={cn(
                            "px-3 py-2 whitespace-nowrap",
                            column.align === "right" || column.numeric
                              ? "text-right tabular-nums"
                              : "text-left",
                            column.numeric ? "text-text-primary" : "text-text-secondary",
                          )}
                        >
                          {column.numeric && row[column.key] !== null && row[column.key] !== undefined
                            ? formatCurrency(String(row[column.key]))
                            : (row[column.key] ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {report.totals && (
                  <tfoot>
                    <tr className="bg-primary-50 dark:bg-primary-900/30 font-bold border-t-2 border-primary">
                      {report.columns.map((column) => (
                        <td
                          key={column.key}
                          className={cn(
                            "px-3 py-2.5 whitespace-nowrap text-text-primary",
                            column.align === "right" || column.numeric
                              ? "text-right tabular-nums"
                              : "text-left",
                          )}
                        >
                          {column.numeric &&
                          report.totals?.[column.key] !== null &&
                          report.totals?.[column.key] !== undefined
                            ? formatCurrency(String(report.totals[column.key]))
                            : (report.totals?.[column.key] ?? "")}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {report.footnotes.length > 0 && (
              <div className="mt-3 space-y-1">
                {report.footnotes.map((note, index) => (
                  <p key={index} className="text-xs text-text-secondary">
                    {note}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
