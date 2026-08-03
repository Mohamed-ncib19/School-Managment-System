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
import { FinancialFilterBar } from "@/components/financial/financial-filters";
import { PageLoader } from "@/components/shared/skeletons";
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

  const { data: dashboard, isLoading } = useFinancialDashboard(filters);
  const { data: revenue, isLoading: revenueLoading } = useRevenueSeries(filters);
  const { data: profit, isLoading: profitLoading } = useProfitSeries(filters);
  const { data: statuses, isLoading: statusLoading } = useStatusDistribution(filters);
  const { data: byLevel, isLoading: levelLoading } = useBreakdown("level", { ...filters, limit: 8 });
  const { data: byField, isLoading: fieldLoading } = useBreakdown("field", { ...filters, limit: 8 });
  const { data: byProfessor, isLoading: profLoading } = useBreakdown("professor", { ...filters, limit: 8 });
  const { data: byGroup, isLoading: groupLoading } = useBreakdown("group", { ...filters, limit: 8 });

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

  return (
    <div className="space-y-6">
      <FinancialFilterBar value={filters} onChange={setFilters} />

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
          loading={isLoading}
        />
        <KpiCard
          label={t("financial.kpi.professorPayroll", "Professor payroll")}
          value={formatCurrency(cards?.professor_payroll.value ?? "0")}
          icon={Wallet}
          tone="warning"
          hint={t("financial.kpi.owedThisPeriod", "Owed this period")}
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
          title={t("financial.chart.byLevel", "Revenue by level")}
          series={[{ key: "revenue", label: t("financial.collected", "Collected"), color: SEQUENTIAL[2] }]}
          tableRows={byLevel}
          labelKey="name"
          labelHeader={t("nav.levels", "Level")}
          loading={levelLoading}
          isEmpty={!byLevel?.length}
        >
          <BreakdownBarChart
            data={byLevel ?? []}
            color={SEQUENTIAL[2]}
            label={t("financial.collected", "Collected")}
          />
        </ChartCard>

        <ChartCard
          title={t("financial.chart.byField", "Revenue by field")}
          series={[{ key: "revenue", label: t("financial.collected", "Collected"), color: SEQUENTIAL[2] }]}
          tableRows={byField}
          labelKey="name"
          labelHeader={t("nav.fields", "Field")}
          loading={fieldLoading}
          isEmpty={!byField?.length}
        >
          <BreakdownBarChart
            data={byField ?? []}
            color={SEQUENTIAL[2]}
            label={t("financial.collected", "Collected")}
          />
        </ChartCard>

        <ChartCard
          title={t("financial.chart.byProfessor", "Revenue by professor")}
          series={[{ key: "revenue", label: t("financial.collected", "Collected"), color: SEQUENTIAL[2] }]}
          tableRows={byProfessor}
          labelKey="name"
          labelHeader={t("nav.professors", "Professor")}
          loading={profLoading}
          isEmpty={!byProfessor?.length}
        >
          <BreakdownBarChart
            data={byProfessor ?? []}
            color={SEQUENTIAL[2]}
            label={t("financial.collected", "Collected")}
          />
        </ChartCard>

        <ChartCard
          title={t("financial.chart.byGroup", "Revenue by group")}
          series={[{ key: "revenue", label: t("financial.collected", "Collected"), color: SEQUENTIAL[2] }]}
          tableRows={byGroup}
          labelKey="name"
          labelHeader={t("nav.groups", "Group")}
          loading={groupLoading}
          isEmpty={!byGroup?.length}
        >
          <BreakdownBarChart
            data={byGroup ?? []}
            color={SEQUENTIAL[2]}
            label={t("financial.collected", "Collected")}
          />
        </ChartCard>
      </div>

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
  );
}
