"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
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

  const payroll = cards?.professor_payroll;
  const payrollOutstanding = Number(payroll?.value ?? "0");
  // Zero (or negative, clamped server-side) means every professor is settled:
  // the card switches to its resting state instead of looking like an open charge.
  const payrollSettled = !!payroll && payrollOutstanding <= 0;
  const payrollMeter = useMemo(() => {
    if (!payroll || payrollSettled) return null;
    const earned = Number(payroll.earned ?? "0");
    const paid = Number(payroll.paid ?? "0");
    return earned > 0 ? Math.min(Math.round((paid / earned) * 100), 100) : null;
  }, [payroll, payrollSettled]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-h2 font-bold text-text-primary mb-1">{t("financial.nav.dashboard", "Tableau de bord")}</h1>
          <p className="text-sm text-text-secondary">{t("financial.dashboard.subtitle", "Vue d'ensemble de la trésorerie de l'académie")}</p>
        </div>
        <Link href="/financial/payments" className="btn btn-primary shrink-0">
          <Banknote size={16} aria-hidden="true" />
          {t("financial.encash", "Encaisser un paiement")}
        </Link>
      </div>

      <FinancialFilterBar value={filters} onChange={setFilters} />

      {isError ? (
        <ErrorState onRetry={refetch} className="py-16" />
      ) : (
        <>
          <section>
            <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
              {t("financial.section.encashments", "Encaissements")}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <KpiCard
                label={t("financial.kpi.collectedInRange", "Encaissé sur la période")}
                value={formatCurrency(cards?.collected_in_range.value ?? "0")}
                icon={CircleDollarSign}
                tone="brand"
                hint={t("financial.kpi.transactionCount", "{count} opérations").replace(
                  "{count}",
                  String(cards?.collected_in_range.count ?? 0),
                )}
                href="/financial/payments"
                loading={isLoading}
              />
              <KpiCard
                label={t("financial.kpi.collectedThisMonth", "Encaissé ce mois-ci")}
                value={formatCurrency(cards?.collected_this_month.value ?? "0")}
                icon={Banknote}
                tone="positive"
                hint={cards?.collected_this_month.period}
                loading={isLoading}
              />
              <KpiCard
                label={t("financial.kpi.schoolNet", "Revenu net de l'école")}
                value={formatCurrency(cards?.school_net_revenue.value ?? "0")}
                icon={Landmark}
                tone="positive"
                hint={t("financial.kpi.professorShareOf", "Professeurs : {amount}").replace(
                  "{amount}",
                  formatCurrency(cards?.school_net_revenue.professor_share ?? "0"),
                )}
                loading={isLoading}
              />
              <KpiCard
                label={t("financial.kpi.totalRevenue", "Encaissé au total")}
                value={formatCurrency(cards?.total_revenue.value ?? "0")}
                icon={Wallet}
                tone="neutral"
                hint={t("financial.kpi.allTime", "Depuis le début")}
                loading={isLoading}
              />
            </div>
          </section>

          <section>
            <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
              {t("financial.section.recouvrement", "Factures et recouvrement")}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <KpiCard
                label={t("financial.kpi.collectionRate", "Taux de recouvrement")}
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
              <KpiCard
                label={t("financial.kpi.pending", "Paiements en attente")}
                value={formatCurrency(cards?.pending_payments.value ?? "0")}
                icon={Clock}
                tone="warning"
                hint={t("financial.kpi.invoiceCount", "{count} factures").replace(
                  "{count}",
                  String(cards?.pending_payments.count ?? 0),
                )}
                href="/financial/payments?status=not_paid"
                loading={isLoading}
              />
              <KpiCard
                label={t("financial.kpi.overdue", "Paiements en retard")}
                value={formatCurrency(cards?.overdue_payments.value ?? "0")}
                icon={AlertTriangle}
                tone="danger"
                hint={t("financial.kpi.invoiceCount", "{count} factures").replace(
                  "{count}",
                  String(cards?.overdue_payments.count ?? 0),
                )}
                href="/financial/payments?status=overdue"
                loading={isLoading}
              />
              <KpiCard
                label={t("financial.kpi.expected", "Revenu attendu")}
                value={formatCurrency(cards?.expected_revenue.value ?? "0")}
                icon={Target}
                tone="neutral"
                hint={t("financial.kpi.invoiceCount", "{count} factures").replace(
                  "{count}",
                  String(cards?.expected_revenue.count ?? 0),
                )}
                loading={isLoading}
              />
            </div>
          </section>

          <section>
            <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
              {t("financial.section.outgoing", "Charges")}
            </h2>
            <Link
              href="/financial/professors"
              className="card flex items-center gap-4 hover:shadow-hover transition-shadow group"
            >
              <div className={payrollSettled
                ? "h-11 w-11 shrink-0 rounded-btn bg-success-soft dark:bg-success-dark-soft flex items-center justify-center text-success-strong dark:text-success-dark-strong"
                : "h-11 w-11 shrink-0 rounded-btn bg-gold-50 dark:bg-gold/15 flex items-center justify-center text-gold-700 dark:text-gold-400"}>
                <Wallet size={20} aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                {isLoading ? (
                  <div className="h-10 w-56 rounded bg-neutral-soft animate-pulse" />
                ) : (
                  <>
                    <div className="flex items-baseline justify-between gap-3 flex-wrap">
                      <p className="text-sm font-semibold text-text-primary">
                        {t("financial.kpi.professorPayroll", "Paie des professeurs")}
                      </p>
                      <p className={payrollSettled
                        ? "text-h4 font-bold tabular-nums text-success-strong dark:text-success-dark-strong"
                        : "text-h4 font-bold tabular-nums text-gold-700 dark:text-gold-400"}>
                        {formatCurrency(payroll?.value ?? "0")}
                      </p>
                    </div>
                    <p className="text-xs text-text-secondary mt-0.5">
                      {payrollSettled
                        ? t("financial.payroll.settled", "Soldé — rien à verser")
                        : t("financial.payroll.outstanding", "Reste à verser")}
                      {payroll && (
                        <>
                          {" · "}
                          {t("financial.payroll.earned", "Acquis")} {formatCurrency(payroll.earned)} {"· "}
                          {t("financial.payroll.paid", "Versé")} {formatCurrency(payroll.paid)}
                        </>
                      )}
                    </p>
                    {payrollMeter !== null && (
                      <div className="mt-2 h-1.5 w-full max-w-md rounded-full bg-neutral-soft overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gold transition-all duration-300"
                          style={{ width: `${payrollMeter}%` }}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
              {!payrollSettled && (
                <span className="btn btn-secondary shrink-0 hidden sm:inline-flex">
                  {t("financial.settle", "Régler")}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </span>
              )}
            </Link>
          </section>

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