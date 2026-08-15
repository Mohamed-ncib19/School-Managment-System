"use client";

import { RevenueChart } from "./revenue-chart";
import { PaymentsByStatusChart } from "./payments-by-status-chart";
import { StudentsByFieldChart } from "./students-by-field-chart";
import { useTranslation } from "@/lib/i18n/context";

interface DashboardChartsProps {
  revenueByMonth: { month: string; revenue: number }[];
  paymentsByStatus: { status: string; count: number }[];
  studentsByField: { field: string; count: number }[];
}

/**
 * The dashboard's three charts in one component so the route imports a single
 * dynamic chunk. The charts are zero-dependency SVG (see svg-charts.tsx) —
 * recharts was dropped because webpack dev inlined the whole recharts + d3
 * tree into every chunk that imported it, dominating the route's compile time.
 */
export function DashboardCharts({ revenueByMonth, paymentsByStatus, studentsByField }: DashboardChartsProps) {
  const { t } = useTranslation();
  return (
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
  );
}