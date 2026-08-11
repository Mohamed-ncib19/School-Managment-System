"use client";

import { useState } from "react";
import { ChevronRight, Home } from "lucide-react";
import { ChartCard } from "@/components/financial/chart-card";
import { ErrorState } from "@/components/financial/error-state";
import { FinancialFilterBar } from "@/components/financial/financial-filters";
import { BreakdownBarChart, TimeSeriesChart } from "@/components/financial/charts";
import {
  useBreakdown,
  useCollectionTrend,
  useLatePaymentTrend,
  useProfessorPerformance,
  useRevenueSeries,
} from "@/hooks/use-financial";
import { useHierarchyConfig } from "@/hooks/use-hierarchy-config";
import type { FinancialFilters } from "@/lib/api/financial.api";
import { SEQUENTIAL, SERIES } from "@/lib/charts/theme";
import { cn, formatCurrency } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";
import type { BreakdownRow } from "@/types";

type Dimension = "level" | "field" | "professor" | "group" | "student";

interface Crumb {
  dimension: Dimension;
  name: string;
  filter: Record<string, string>;
}

/**
 * Revenue Analytics, with drill-down.
 *
 * Clicking a bar descends into whatever the server says sits beneath it — each
 * breakdown row carries its own `drill_to` and the filter to apply — so the path
 * follows the data model rather than a hierarchy hard-coded in this file. The
 * configured navigation order supplies the entity *labels*, so the chart calls a
 * level whatever the rest of the app calls it.
 */
export default function RevenueAnalyticsPage() {
  const { t } = useTranslation();
  const { entityOrder, getEntityLabel } = useHierarchyConfig();
  const [filters, setFilters] = useState<FinancialFilters>({
    granularity: "monthly",
    range: "academic_year",
  });
  const [trail, setTrail] = useState<Crumb[]>([]);

  // The first academic entity in the configured order is where a drill-down
  // starts; anything the ledger cannot break down by is skipped.
  const rootDimension = (entityOrder.find((entity) =>
    ["level", "field", "professor", "group"].includes(entity),
  ) ?? "level") as Dimension;

  const activeDimension = trail.length > 0
    ? ((trail[trail.length - 1].filter && nextOf(trail[trail.length - 1].dimension)) ?? rootDimension)
    : rootDimension;

  // Drill filters accumulate, so descending narrows rather than replaces.
  const drillFilters: FinancialFilters = {
    ...filters,
    ...trail.reduce((acc, crumb) => ({ ...acc, ...crumb.filter }), {} as Record<string, string>),
  };

  const { data: revenue, isLoading: revenueLoading, isError, refetch } = useRevenueSeries(filters);
  const { data: collection, isLoading: collectionLoading } = useCollectionTrend(filters);
  const { data: late, isLoading: lateLoading } = useLatePaymentTrend(filters);
  const { data: performance, isLoading: perfLoading } = useProfessorPerformance({ ...filters, limit: 10 });
  const { data: breakdown, isLoading: breakdownLoading } = useBreakdown(activeDimension, {
    ...drillFilters,
    limit: 12,
  });

  const growthSeries = [
    { key: "revenue", label: t("financial.collected", "Collected"), color: SERIES.revenue },
    { key: "school_share", label: t("financial.schoolShare", "School share"), color: SERIES.school },
  ];

  const collectionSeries = [
    { key: "expected", label: t("financial.expected", "Expected"), color: SERIES.expected },
    { key: "collected", label: t("financial.collected", "Collected"), color: SERIES.collected },
  ];

  const lateSeries = [
    { key: "late", label: t("financial.lateCount", "Late"), color: SERIES.professor },
    { key: "on_time", label: t("financial.onTimeCount", "On time"), color: SERIES.school },
  ];

  const descend = (row: BreakdownRow) => {
    if (!row.drill_to || !row.drill_filter) return;
    setTrail((current) => [
      ...current,
      { dimension: activeDimension, name: row.name, filter: row.drill_filter! },
    ]);
  };

  const rewind = (index: number) => setTrail((current) => current.slice(0, index));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-h2 font-bold text-text-primary mb-1">{t("nav.financial", "Finance")} · {t("financial.analytics", "Analytique")}</h1>
        <p className="text-sm text-text-secondary">
          {t("financial.analyticsSub", "Tendances de revenus, rentabilité et indicateurs de recouvrement")}
        </p>
      </div>
      <FinancialFilterBar value={filters} onChange={setFilters} />

      {isError && <ErrorState onRetry={refetch} />}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartCard
          title={t("financial.chart.revenueGrowth", "Revenue growth")}
          series={growthSeries}
          tableRows={revenue?.points}
          loading={revenueLoading}
          isEmpty={!revenue?.points?.some((p) => Number(p.revenue) !== 0)}
        >
          <TimeSeriesChart data={revenue?.points ?? []} series={growthSeries} variant="area" />
        </ChartCard>

        <ChartCard
          title={t("financial.chart.collectionTrend", "Collection trend")}
          subtitle={t("financial.chart.collectionTrendSub", "Invoiced against collected, by due date")}
          series={collectionSeries}
          tableRows={collection?.points}
          loading={collectionLoading}
          isEmpty={!collection?.points?.some((p: any) => Number(p.expected) !== 0)}
        >
          <TimeSeriesChart data={collection?.points ?? []} series={collectionSeries} variant="line" />
        </ChartCard>

        <ChartCard
          title={t("financial.chart.latePayments", "Late payment trend")}
          subtitle={t("financial.chart.latePaymentsSub", "Invoices settled after their due date")}
          series={lateSeries}
          currencyKeys={[]}
          tableRows={late?.points}
          loading={lateLoading}
          isEmpty={!late?.points?.some((p: any) => p.late + p.on_time > 0)}
        >
          <TimeSeriesChart
            data={late?.points ?? []}
            series={lateSeries}
            countKeys={["late", "on_time"]}
            variant="line"
          />
        </ChartCard>

        <div className="card">
          <h3 className="text-sm font-bold text-text-primary mb-1">
            {t("financial.chart.topProfessors", "Top revenue professors")}
          </h3>
          <p className="text-xs text-text-secondary mb-3">
            {t("financial.chart.topProfessorsSub", "Ranked by revenue generated, not by what they earn")}
          </p>
          {perfLoading ? (
            <div className="h-56 rounded-card bg-neutral-soft dark:bg-white/10 animate-pulse" />
          ) : !performance?.length ? (
            <p className="text-sm text-text-secondary py-8 text-center">
              {t("financial.noDataForFilters", "No data for the selected filters.")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-2 py-2 text-left text-xs font-semibold text-text-secondary uppercase">
                      {t("nav.professors", "Professor")}
                    </th>
                    <th className="px-2 py-2 text-right text-xs font-semibold text-text-secondary uppercase">
                      {t("nav.students", "Students")}
                    </th>
                    <th className="px-2 py-2 text-right text-xs font-semibold text-text-secondary uppercase">
                      {t("financial.revenueGenerated", "Revenue")}
                    </th>
                    <th className="px-2 py-2 text-right text-xs font-semibold text-text-secondary uppercase">
                      {t("financial.schoolShare", "School")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {performance.map((row: any) => (
                    <tr key={row.id} className="hover:bg-background/50">
                      <td className="px-2 py-2">
                        <p className="text-text-primary font-medium">{row.name}</p>
                        <p className="text-xs text-text-secondary">{row.field?.name ?? "—"}</p>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-text-secondary">
                        {row.student_count}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-medium">
                        {formatCurrency(row.revenue_generated)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-text-secondary">
                        {formatCurrency(row.school_share)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ChartCard
        title={t("financial.chart.byStructure", "Revenue by academic structure")}
        subtitle={t("financial.drillHint", "Click a bar to drill deeper")}
        series={[{ key: "revenue", label: t("financial.collected", "Collected"), color: SEQUENTIAL[2] }]}
        tableRows={breakdown}
        labelKey="name"
        labelHeader={getEntityLabel(activeDimension as any)}
        loading={breakdownLoading}
        isEmpty={!breakdown?.length}
        actions={
          <nav aria-label={t("financial.drillPath", "Drill path")} className="flex items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => rewind(0)}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded-btn transition-colors",
                trail.length === 0 ? "text-text-primary font-medium" : "text-primary hover:bg-background",
              )}
            >
              <Home size={12} aria-hidden="true" />
              {getEntityLabel(rootDimension as any)}
            </button>
            {trail.map((crumb, index) => (
              <span key={`${crumb.name}-${index}`} className="flex items-center gap-1">
                <ChevronRight size={12} className="text-text-secondary" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => rewind(index + 1)}
                  className={cn(
                    "px-2 py-1 rounded-btn transition-colors",
                    index === trail.length - 1
                      ? "text-text-primary font-medium"
                      : "text-primary hover:bg-background",
                  )}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>
        }
      >
        <BreakdownBarChart
          data={breakdown ?? []}
          color={SEQUENTIAL[2]}
          label={t("financial.collected", "Collected")}
          onSelect={(selected) => {
            const row = breakdown?.find((candidate) => candidate.id === selected.id);
            if (row) descend(row);
          }}
        />
      </ChartCard>
    </div>
  );
}

/** The academic chain revenue rolls up through. */
function nextOf(dimension: Dimension): Dimension | null {
  const chain: Dimension[] = ["level", "field", "professor", "group", "student"];
  const index = chain.indexOf(dimension);
  return index === -1 || index >= chain.length - 1 ? null : chain[index + 1];
}
