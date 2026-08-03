"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Users,
  CircleDollarSign,
  AlertTriangle,
  ArrowUpRight,
  TrendingUp,
  Clock,
  BookOpen,
  ClipboardList,
  UserCheck,
} from "lucide-react";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { DashboardSkeleton, PageLoader } from "@/components/shared/skeletons";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { PaymentsByStatusChart } from "@/components/charts/payments-by-status-chart";
import { StudentsByFieldChart } from "@/components/charts/students-by-field-chart";
import { useStudents, useFields, useProfessors } from "@/hooks/use-queries";
import {
  useFinancialDashboard,
  useFinancialPayments,
  useRevenueSeries,
  useStatusDistribution,
} from "@/hooks/use-financial";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";

export default function DashboardPage() {
  const { data: students, isLoading: studentsLoading } = useStudents(undefined, { refetchInterval: 30000 });
  const { data: fields } = useFields({ refetchInterval: 30000 });
  const { data: professors } = useProfessors(undefined, { refetchInterval: 30000 });
  const { t } = useTranslation();

  // Every figure below comes from the financial module's aggregates rather than
  // from a full payment list reduced in the browser. That list endpoint no
  // longer exists, and re-deriving revenue here would be a second place the
  // professor/school split could drift from RevenueCalculationService.
  const { data: finance, isLoading: financeLoading } = useFinancialDashboard({});
  const { data: today } = useFinancialDashboard({ range: "today" });
  const { data: revenue } = useRevenueSeries({ granularity: "monthly" });
  const { data: statusSlices } = useStatusDistribution({});
  const { data: recent } = useFinancialPayments({
    status: "paid",
    limit: 5,
    sortBy: "due_date",
    sortDir: "desc",
  });

  const totalRevenue = Number(finance?.cards.total_revenue.value ?? 0);
  const pendingCount = finance?.cards.pending_payments.count ?? 0;
  const overdueCount = finance?.cards.overdue_payments.count ?? 0;
  const todayPaymentsCount = today?.cards.collected_in_range.count ?? 0;
  const recentPayments = recent?.data ?? [];

  const recentStudents = useMemo(
    () => [...(students ?? [])].sort((a, b) => new Date(b.enrollment_date).getTime() - new Date(a.enrollment_date).getTime()).slice(0, 5),
    [students],
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

  const studentsByField = useMemo(() => {
    const fieldMap: Record<string, number> = {};
    students?.forEach((s) => {
      const fieldName = s.group?.professor?.field?.name ?? "Unknown";
      fieldMap[fieldName] = (fieldMap[fieldName] ?? 0) + 1;
    });
    return Object.entries(fieldMap).map(([field, count]) => ({ field, count }));
  }, [students]);

  const isLoading = studentsLoading || financeLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h2 font-bold text-text-primary mb-1">{t("dashboard.welcomeBack")}</h1>
        <p className="text-sm text-text-secondary">{t("dashboard.subtitle")}</p>
      </div>

      {isLoading ? (
        <PageLoader text={t("common.loading", "Loading…")} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <StatCard icon={<Users size={20} />} title={t("dashboard.totalStudents")} value={students?.length ?? 0} />
          <StatCard icon={<UserCheck size={20} />} title={t("dashboard.totalFields", "Total Professors")} value={professors?.length ?? 0} />
          <StatCard icon={<CircleDollarSign size={20} />} title={t("dashboard.monthlyRevenue")} value={formatCurrency(totalRevenue)} />
          <StatCard icon={<Clock size={20} className="text-sky-400" />} title={"Today's Payments"} value={todayPaymentsCount} />
          <StatCard icon={<AlertTriangle size={20} className="text-gold-500" />} title={"Pending"} value={pendingCount} />
          <StatCard icon={<AlertTriangle size={20} className="text-red-500" />} title={t("dashboard.overdue")} value={overdueCount} />
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/students" className="card hover:shadow-hover transition-shadow group">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-colors">
              <Users size={24} />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">{t("nav.students")}</p>
              <p className="text-xs text-text-secondary">{t("dashboard.totalStudents")}: {students?.length ?? 0}</p>
            </div>
          </div>
        </Link>
        <Link href="/financial/payments" className="card hover:shadow-hover transition-shadow group">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-card bg-gold-50 dark:bg-gold/15 flex items-center justify-center text-gold-700 dark:text-gold-400 group-hover:bg-gold group-hover:text-white transition-colors">
              <CircleDollarSign size={24} />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">{t("nav.studentPayments")}</p>
              <p className="text-xs text-text-secondary">{t("dashboard.monthlyRevenue")}: {formatCurrency(totalRevenue)}</p>
            </div>
          </div>
        </Link>
        <Link href="/hierarchy" className="card hover:shadow-hover transition-shadow group">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-card bg-sky-50 dark:bg-sky/15 flex items-center justify-center text-sky-600 dark:text-sky-400 group-hover:bg-sky-500 group-hover:text-white transition-colors">
              <BookOpen size={24} />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">{t("nav.fields")}</p>
              <p className="text-xs text-text-secondary">{t("dashboard.totalFields", "Fields")}: {fields?.length ?? 0}</p>
            </div>
          </div>
        </Link>
        <Link href="/audit" className="card hover:shadow-hover transition-shadow group">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-colors">
              <ClipboardList size={24} />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">{t("nav.audit")}</p>
              <p className="text-xs text-text-secondary">{t("dashboard.viewLogs", "View logs")}</p>
            </div>
          </div>
        </Link>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="card">
          <h2 className="text-h4 font-bold text-text-primary flex items-center gap-2 mb-4">
            <CircleDollarSign size={18} className="text-primary" />
            {t("dashboard.revenueByMonth")}
          </h2>
          <RevenueChart data={revenueByMonth} />
        </div>
        <div className="card">
          <h2 className="text-h4 font-bold text-text-primary flex items-center gap-2 mb-4">
            <TrendingUp size={18} className="text-primary" />
            {t("dashboard.paymentsByStatus")}
          </h2>
          <PaymentsByStatusChart data={paymentsByStatus} />
        </div>
        <div className="card">
          <h2 className="text-h4 font-bold text-text-primary flex items-center gap-2 mb-4">
            <Users size={18} className="text-primary" />
            {t("dashboard.studentsPerField")}
          </h2>
          <StudentsByFieldChart data={studentsByField} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-h4 font-bold text-text-primary flex items-center gap-2">
              <CircleDollarSign size={18} className="text-primary" />
              {t("dashboard.recentPayments")}
            </h2>
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
                      <td className="px-4 py-3 text-right font-medium">{p.paid_amount ? formatCurrency(p.paid_amount) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-h4 font-bold text-text-primary flex items-center gap-2">
              <TrendingUp size={18} className="text-primary" />
              {t("dashboard.latestEnrollments")}
            </h2>
            <Link href="/hierarchy" className="text-xs text-primary hover:text-primary-600 flex items-center gap-1">
              {t("dashboard.viewAll")} <ArrowUpRight size={12} />
            </Link>
          </div>
          {recentStudents.length === 0 ? (
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
                  {recentStudents.map((s) => (
                    <tr key={s.id} className="hover:bg-background/50 transition-colors">
                      <td className="px-4 py-3 font-medium">{s.first_name} {s.last_name}</td>
                      <td className="px-4 py-3 text-text-secondary">{formatDate(s.enrollment_date)}</td>
                      <td className="px-4 py-3">{formatCurrency(s.monthly_fee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {dueSoonCount > 0 && (
        <div className="card border-l-4 border-l-gold bg-gold-50 dark:bg-gold/10">
          <div className="flex items-center gap-3">
            <Clock size={20} className="text-gold-500 dark:text-gold-400 shrink-0" />
            <div>
              <p className="text-sm font-medium text-text-primary">
                <span className="font-bold">{dueSoonCount}</span> {t("dashboard.paymentsDueSoon")}
              </p>
              <p className="text-xs text-text-secondary">{t("dashboard.checkPayments")}</p>
            </div>
          </div>
        </div>
      )}

      {overdueCount > 0 && (
        <div className="card border-l-4 border-l-danger bg-danger-soft dark:bg-danger/10">
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} className="text-danger shrink-0" />
            <div>
              <p className="text-sm font-medium text-text-primary">
                <span className="font-bold">{overdueCount}</span> {t("dashboard.overduePayments")}
              </p>
              <p className="text-xs text-text-secondary">{t("dashboard.takeAction")}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
