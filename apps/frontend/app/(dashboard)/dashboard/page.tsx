"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Users,
  CircleDollarSign,
  ArrowUpRight,
  AlertTriangle,
  Clock,
  BookOpen,
  ClipboardList,
  UserCheck,
} from "lucide-react";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { PageLoader } from "@/components/shared/skeletons";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { PaymentsByStatusChart } from "@/components/charts/payments-by-status-chart";
import { StudentsByFieldChart } from "@/components/charts/students-by-field-chart";
import { useHierarchySummary, useRecentStudents } from "@/hooks/use-queries";
import {
  useFinancialDashboard,
  useFinancialPayments,
  useRevenueSeries,
  useStatusDistribution,
} from "@/hooks/use-financial";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";

export default function DashboardPage() {
  const { data: recentStudents } = useRecentStudents(5, { refetchInterval: 60000 });
  const { data: hierarchy, isLoading: hierarchyLoading } = useHierarchySummary({ refetchInterval: 60000 });
  const { t } = useTranslation();

  const totalStudents = hierarchy?.levels?.reduce((sum, l) => sum + (l.students ?? 0), 0) ?? 0;
  const totalFields = hierarchy?.fields?.length ?? 0;
  const totalProfessors = hierarchy?.professors?.length ?? 0;

  const { data: finance, isLoading: financeLoading } = useFinancialDashboard({});
  const { data: today } = useFinancialDashboard({ range: "today" });
  const { data: revenue } = useRevenueSeries({ granularity: "monthly" });
  const { data: statusSlices } = useStatusDistribution({});
  const { data: recent } = useFinancialPayments({
    status: "paid",
    limit: 5,
    sortBy: "due_date",
    sortDir: "desc",
    refetchInterval: 60000,
  });

  const totalRevenue = Number(finance?.cards.total_revenue.value ?? 0);
  const pendingCount = finance?.cards.pending_payments.count ?? 0;
  const overdueCount = finance?.cards.overdue_payments.count ?? 0;
  const todayPaymentsCount = today?.cards.collected_in_range.count ?? 0;
  const recentPayments = recent?.data ?? [];

  const displayRecentStudents = useMemo(
    () => (recentStudents ?? []).slice(0, 5),
    [recentStudents],
  );

  const revenueByMonth = useMemo(
    () =>
      (revenue?.points ?? []).slice(-6).map((point) => {
        const [year, month] = point.bucket.split("-");
        return {
          month: new Date(Number(year), Number(month) - 1).toLocaleDateString("en-US", { month: "short" }),
          revenue: Number(point.revenue),
        };
      }),
    [revenue],
  );

  const paymentsByStatus = useMemo(
    () => (statusSlices ?? []).map((slice) => ({ status: slice.status, count: slice.count })),
    [statusSlices],
  );

  // Drives the "due soon" banner. Taken from the same distribution the chart
  // shows, so the two can never disagree.
  const dueSoonCount = useMemo(
    () => (statusSlices ?? []).find((slice) => slice.status === "due_soon")?.count ?? 0,
    [statusSlices],
  );

  const studentsByField = useMemo(
    () =>
      (hierarchy?.fields ?? [])
        .filter((f) => (f.students ?? 0) > 0)
        .map((f) => ({ field: f.name, count: f.students ?? 0 })),
    [hierarchy],
  );

  const isLoading = hierarchyLoading || financeLoading;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-h2 font-bold text-text-primary mb-1">{t("dashboard.welcomeBack")}</h1>
        <p className="text-sm text-text-secondary">{t("dashboard.subtitle")}</p>
      </div>

      {isLoading ? (
        <PageLoader text={t("common.loading", "Loading…")} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard icon={<Users size={18} />} title={t("dashboard.totalStudents")} value={totalStudents} />
          <StatCard icon={<UserCheck size={18} />} title={t("dashboard.totalFields", "Total Professors")} value={totalProfessors} />
          <StatCard icon={<CircleDollarSign size={18} />} title={t("dashboard.monthlyRevenue")} value={formatCurrency(totalRevenue)} />
          <StatCard icon={<Clock size={18} />} title={"Today's Payments"} value={todayPaymentsCount} />
        </div>
      )}

      {/* Attention banners: the unpaid invoices, distilled. */}
      {(dueSoonCount > 0 || overdueCount > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {dueSoonCount > 0 && (
            <Link
              href="/financial/payments?status=due_soon"
              className="flex items-center gap-3 rounded-btn border border-gold/30 bg-gold-50 dark:bg-gold/10 px-4 py-3 transition-colors hover:bg-gold-100 dark:hover:bg-gold/15"
            >
              <Clock size={18} className="text-gold-500 dark:text-gold-400 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary">
                  {dueSoonCount} {t("dashboard.paymentsDueSoon")}
                </p>
                <p className="text-xs text-text-secondary truncate">{t("dashboard.checkPayments")}</p>
              </div>
              <ArrowUpRight size={16} className="ml-auto shrink-0 text-text-secondary" aria-hidden="true" />
            </Link>
          )}
          {overdueCount > 0 && (
            <Link
              href="/financial/payments?status=overdue"
              className="flex items-center gap-3 rounded-btn border border-danger/30 bg-danger-soft dark:bg-danger/10 px-4 py-3 transition-colors hover:bg-danger/10 dark:hover:bg-danger/15"
            >
              <AlertTriangle size={18} className="text-danger shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary">
                  {overdueCount} {t("dashboard.overduePayments")}
                </p>
                <p className="text-xs text-text-secondary truncate">{t("dashboard.takeAction")}</p>
              </div>
              <ArrowUpRight size={16} className="ml-auto shrink-0 text-text-secondary" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}

      {/* Quick actions */}
      <section>
        <h2 className="text-sm font-semibold text-text-secondary mb-3">{t("dashboard.quickActions", "Accès rapides")}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Link href="/hierarchy/student" className="card hover:shadow-hover transition-shadow group">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-card bg-neutral-soft dark:bg-white/10 flex items-center justify-center text-text-secondary group-hover:text-primary transition-colors">
                <Users size={20} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{t("nav.students")}</p>
                <p className="text-xs text-text-secondary tabular-nums">{totalStudents}</p>
              </div>
            </div>
          </Link>
          <Link href="/financial/payments" className="card hover:shadow-hover transition-shadow group">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-card bg-neutral-soft dark:bg-white/10 flex items-center justify-center text-text-secondary group-hover:text-primary transition-colors">
                <CircleDollarSign size={20} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{t("nav.studentPayments")}</p>
                <p className="text-xs text-text-secondary truncate">{formatCurrency(totalRevenue)}</p>
              </div>
            </div>
          </Link>
          <Link href="/hierarchy" className="card hover:shadow-hover transition-shadow group">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-card bg-neutral-soft dark:bg-white/10 flex items-center justify-center text-text-secondary group-hover:text-primary transition-colors">
                <BookOpen size={20} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{t("nav.fields")}</p>
                <p className="text-xs text-text-secondary tabular-nums">{totalFields}</p>
              </div>
            </div>
          </Link>
          <Link href="/audit" className="card hover:shadow-hover transition-shadow group">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-card bg-neutral-soft dark:bg-white/10 flex items-center justify-center text-text-secondary group-hover:text-primary transition-colors">
                <ClipboardList size={20} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{t("nav.audit")}</p>
                <p className="text-xs text-text-secondary truncate">{t("dashboard.viewLogs", "View logs")}</p>
              </div>
            </div>
          </Link>
        </div>
      </section>

      {/* Charts */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="card">
          <h2 className="text-h4 font-bold text-text-primary mb-4">{t("dashboard.revenueByMonth")}</h2>
          <RevenueChart data={revenueByMonth} />
        </div>
        <div className="card">
          <h2 className="text-h4 font-bold text-text-primary mb-4">{t("dashboard.paymentsByStatus")}</h2>
          <PaymentsByStatusChart data={paymentsByStatus} />
        </div>
        <div className="card">
          <h2 className="text-h4 font-bold text-text-primary mb-4">{t("dashboard.studentsPerField")}</h2>
          <StudentsByFieldChart data={studentsByField} />
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-h4 font-bold text-text-primary">{t("dashboard.recentPayments")}</h2>
            <Link href="/financial/payments" className="text-xs text-primary hover:text-primary-600 flex items-center gap-1">
              {t("dashboard.viewAll")} <ArrowUpRight size={12} />
            </Link>
          </div>
          {recentPayments.length === 0 ? (
            <p className="text-sm text-text-secondary py-8 text-center">{t("dashboard.noPayments")}</p>
          ) : (
            <div className="overflow-hidden rounded-table border border-border">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-background">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("dashboard.student")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("dashboard.period")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("dashboard.status")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("dashboard.amount")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentPayments.map((p) => (
                    <tr key={p.id} className="hover:bg-background/50 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/students/${p.student_id}/payments`} className="text-primary hover:text-primary-600 font-medium">
                          {p.student?.first_name} {p.student?.last_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{p.period}</td>
                      <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">{p.paid_amount ? formatCurrency(p.paid_amount) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-h4 font-bold text-text-primary">{t("dashboard.latestEnrollments")}</h2>
            <Link href="/hierarchy" className="text-xs text-primary hover:text-primary-600 flex items-center gap-1">
              {t("dashboard.viewAll")} <ArrowUpRight size={12} />
            </Link>
          </div>
          {displayRecentStudents.length === 0 ? (
            <p className="text-sm text-text-secondary py-8 text-center">{t("dashboard.noStudents")}</p>
          ) : (
            <div className="overflow-hidden rounded-table border border-border">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-background">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("dashboard.name")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("dashboard.enrolled")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("dashboard.fee")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {displayRecentStudents.map((s) => (
                    <tr key={s.id} className="hover:bg-background/50 transition-colors">
                      <td className="px-4 py-3 font-medium">{s.first_name} {s.last_name}</td>
                      <td className="px-4 py-3 text-text-secondary">{formatDate(s.enrollment_date)}</td>
                      <td className="px-4 py-3 tabular-nums">{formatCurrency(s.monthly_fee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {pendingCount > 0 && (
        <p className="text-xs text-text-secondary text-center">
          {pendingCount} {t("dashboard.paymentsDueSoon", "paiements en attente")}
        </p>
      )}
    </div>
  );
}
