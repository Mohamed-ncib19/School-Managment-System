"use client";

import { DonutChartSvg } from "./svg-charts";
import { useTranslation } from "@/lib/i18n/context";

const STATUS_COLORS: Record<string, string> = {
  paid: "var(--chart-paid)",
  due_soon: "var(--chart-partial)",
  partially_paid: "var(--chart-partial)",
  not_paid: "var(--chart-pending)",
  overdue: "var(--chart-overdue)",
  cancelled: "var(--chart-cancelled)",
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  paid: "statusBadge.paid",
  due_soon: "statusBadge.dueSoon",
  partially_paid: "statusBadge.partial",
  not_paid: "statusBadge.pending",
  overdue: "statusBadge.overdue",
  cancelled: "statusBadge.cancelled",
};

interface PaymentsByStatusChartProps {
  data: { status: string; count: number }[];
}

export function PaymentsByStatusChart({ data }: PaymentsByStatusChartProps) {
  const { t } = useTranslation();
  if (!data.length || data.every((d) => d.count === 0)) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-text-secondary">
        {t("charts.noPaymentData")}
      </div>
    );
  }

  const chartData = data
    .filter((d) => d.count > 0)
    .map((d) => ({
      label: t(STATUS_LABEL_KEYS[d.status] ?? "") || d.status,
      value: d.count,
      color: STATUS_COLORS[d.status] ?? "var(--chart-pending)",
    }));

  return (
    <DonutChartSvg
      data={chartData}
      formatValue={(v) => String(v)}
      ariaLabel={t("dashboard.paymentsByStatus")}
    />
  );
}