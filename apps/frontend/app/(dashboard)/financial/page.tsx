"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CircleDollarSign,
  Clock,
  Gauge,
  Landmark,
  Target,
  Wallet,
} from "lucide-react";
import { KpiCard } from "@/components/financial/kpi-card";
import { ChartCard } from "@/components/financial/chart-card";
import { ErrorState } from "@/components/financial/error-state";
import { FinancialFilterBar } from "@/components/financial/financial-filters";
import {
  BreakdownBarChart,
  StatusDonutChart,
  TimeSeriesChart,
} from "@/components/financial/charts";
import {
  useBreakdown,
  useFinancialDashboard,
  useProfitSeries,
  useRevenueSeries,
  useStatusDistribution,
} from "@/hooks/use-financial";
import type { FinancialFilters } from "@/lib/api/financial.api";
import { SERIES, SEQUENTIAL } from "@/lib/charts/theme";
import { formatCurrency } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";

/** The four academic structure dimensions share one chart card, one query at a time. */
const BREAKDOWN_DIMENSIONS = [
  { key: "level", label: "financial.chart.byLevel", labelHeader: "nav.levels", fallbackHeader: "Level" },
  { key: "field", label: "financial.chart.byField", labelHeader: "nav.fields", fallbackHeader: "Field" },
  { key: "professor", label: "financial.chart.byProfessor", labelHeader: "nav.professors", fallbackHeader: "Professor" },
  { key: "group", label: "financial.chart.byGroup", labelHeader: "nav.groups", fallbackHeader: "Group" },
] as const;

/**
 * The financial dashboard: eight KPI cards over the charts that explain them.
 *
 * Every figure comes from the server already aggregated. Nothing on this page
 * sums a list of payments in the browser — that is what the screen it replaces
 * did, and it meant fetching every invoice in the academy to render four totals.
 */
export default function FinancialDashboardPage() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<FinancialFilters>({
    granularity: "monthly",
    range: "academic_year",
  });
  const [dimension, setDimension] = useState<(typeof BREAKDOWN_DIMENSIONS)[number]["key"]>("level");

  const { data: dashboard, isLoading, isError, refetch } = useFinancialDashboard(filters);
  const { data: revenue, isLoading: revenueLoading } = useRevenueSeries(filters);
  const { data: profit, isLoading: profitLoading } = useProfitSeries(filters);
  const { data: statuses, isLoading: statusLoading } = useStatusDistribution(filters);
  const { data: breakdown, isLoading: breakdownLoading } = useBreakdown(dimension, { ...filters, limit: 8 });

  const cards = dashboard?.cards;

  const statusRows = useMemo(
    () =>
      (statuses ?? []).map((slice) => ({
        status: slice.status,
        count: slice.count,
        label: t(`payments.statuses.${slice.status}`, slice.status.replace(/_/g, " ")),
        amount_due: slice.amount_due,
      })),
    [statuses, t],
  );

  const revenueSeries = [
    { key: "school_share", label: t("financial.schoolShare", "School share"), color: SERIES.school },
    { key: "professor_share", label: t("financial.professorShare", "Professor share"), color: SERIES.professor },
  ];

  const profitSeries = [
    { key: "school_share", label: t("financial.schoolShare", "School share"), color: SERIES.school },
    { key: "payroll_paid", label: t("financial.payrollPaid", "Payroll paid"), color: SERIES.payroll },
    { key: "profit", label: t("financial.netProfit", "Net"), color: SERIES.profit },
  ];

  const activeDimension = BREAKDOWN_DIMENSIONS.find((d) => d.key === dimension)!;

  return (
    <div className="space-y-6">
      <FinancialFilterBar value={filters} onChange={setFilters} />

      {isError ? (
        <ErrorState onRetry={refetch} className="py-16" />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiCard
              label={t("financial.kpi.totalRevenue", "Total revenue")}
              value={formatCurrency(cards?.total_revenue.value ?? "0")}
              icon={CircleDollarSign}
              tone="brand"
              hint={t("financial.kpi.allTime", "All time")}
              loading={isLoading}
            />
            <KpiCard
              label={t("financial.kpi.collectedThisMonth", "Collected this month")}
              value={formatCurrency(cards?.collected_this_month.value ?? "0")}
              icon={Banknote}
              tone="positive"
              hint={cards?.collected_this_month.period}
              href="/financial/payments"
              loading={isLoading}
            />
            <KpiCard
              label={t("financial.kpi.pending", "Pending payments")}
              value={formatCurrency(cards?.pending_payments.value ?? "0")}
              icon={Clock}
              tone="warning"
              hint={t("financial.kpi.invoiceCount", "{count} invoices").replace(
                "{count}",
                String(cards?.pending_payments.count ?? 0),
              )}
              href="/financial/payments?status=not_paid"
              loading={isLoading}
            />
            <KpiCard
              label={t("financial.kpi.overdue", "Overdue payments")}
              value={formatCurrency(cards?.overdue_payments.value ?? "0")}
              icon={AlertTriangle}
              tone="danger"
              hint={t("financial.kpi.invoiceCount", "{count} invoices").replace(
                "{count}",
                String(cards?.overdue_payments.count ?? 0),
              )}
              href="/financial/payments?status=overdue"
              loading={isLoading}
            />
            <KpiCard
              label={t("financial.kpi.professorPayroll", "Professor payroll")}
              value={formatCurrency(cards?.professor_payroll.value ?? "0")}
              icon={Wallet}
              tone="warning"
              hint={t("financial.kpi.owedThisPeriod", "Owed this period")}
              href="/financial/professors"
              loading={isLoading}
            />
            <KpiCard
              label={t("financial.kpi.schoolNet", "School net revenue")}
              value={formatCurrency(cards?.school_net_revenue.value ?? "0")}
              icon={Landmark}
              tone="positive"
              hint={t("financial.kpi.professorShareOf", "Professors: {amount}").replace(
                "{amount}",
                formatCurrency(cards?.school_net_revenue.professor_share ?? "0"),
              )}
              loading={isLoading}
            />
            <KpiCard
              label={t("financial.kpi.expected", "Expected revenue")}
              value={formatCurrency(cards?.expected_revenue.value ?? "0")}
              icon={Target}
              tone="neutral"
              hint={t("financial.kpi.invoiceCount", "{count} invoices").replace(
                "{count}",
                String(cards?.expected_revenue.count ?? 0),
              )}
              loading={isLoading}
            />
            <KpiCard
              label={t("financial.kpi.collectionRate", "Collection rate")}
              value={`${cards?.collection_rate.value ?? 0}%`}
              icon={Gauge}
              tone="brand"
              hint={`${formatCurrency(cards?.collection_rate.collected ?? "0")} / ${formatCurrency(
                cards?.collection_rate.expected ?? "0",
              )}`}
              meter={cards?.collection_rate.value ?? 0}
              href="/financial/analytics"
              loading={isLoading}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard
              title={t("financial.chart.monthlyRevenue", "Revenue over time")}
              subtitle={t("financial.chart.monthlyRevenueSub", "Collected, split between the academy and its professors")}
              series={revenueSeries}
              tableRows={revenue?.points}
              loading={revenueLoading}
              isEmpty={!revenue?.points?.some((p) => Number(p.revenue) !== 0)}
            >
              <TimeSeriesChart data={revenue?.points ?? []} series={revenueSeries} variant="stacked-area" />
            </ChartCard>

            <ChartCard
              title={t("financial.chart.profitTrend", "Profit trend")}
              subtitle={t("financial.chart.profitTrendSub", "What the academy kept, against what it paid out")}
              series={profitSeries}
              tableRows={profit?.points}
              loading={profitLoading}
              isEmpty={!profit?.points?.some((p: any) => Number(p.school_share) !== 0)}
            >
              <TimeSeriesChart data={profit?.points ?? []} series={profitSeries} variant="line" />
            </ChartCard>

            <ChartCard
              title={t("financial.chart.byStructure", "Revenue by academic structure")}
              series={[{ key: "revenue", label: t("financial.collected", "Collected"), color: SEQUENTIAL[2] }]}
              tableRows={breakdown}
              labelKey="name"
              labelHeader={t(activeDimension.labelHeader, activeDimension.fallbackHeader)}
              loading={breakdownLoading}
              isEmpty={!breakdown?.length}
              actions={
                <div className="flex items-center gap-1 rounded-lg bg-neutral-soft p-1">
                  {BREAKDOWN_DIMENSIONS.map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => setDimension(d.key)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        dimension === d.key
                          ? "bg-surface shadow-sm text-text-primary"
                          : "text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      {t(d.label)}
                    </button>
                  ))}
                </div>
              }
            >
              <BreakdownBarChart
                data={breakdown ?? []}
                color={SEQUENTIAL[2]}
                label={t("financial.collected", "Collected")}
              />
            </ChartCard>

            <ChartCard
              title={t("financial.chart.statusDistribution", "Payment status distribution")}
              subtitle={t("financial.chart.statusSub", "Invoices in the selected window, by state")}
              series={[
                { key: "count", label: t("financial.invoices", "Invoices"), color: SERIES.revenue },
                { key: "amount_due", label: t("payments.amountDue", "Amount due"), color: SERIES.school },
              ]}
              currencyKeys={["amount_due"]}
              tableRows={statusRows.map((row) => ({ name: row.label, count: row.count, amount_due: row.amount_due }))}
              labelKey="name"
              labelHeader={t("payments.status", "Status")}
              loading={statusLoading}
              isEmpty={!statusRows.length}
              hideLegend
            >
              <StatusDonutChart data={statusRows} />
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}