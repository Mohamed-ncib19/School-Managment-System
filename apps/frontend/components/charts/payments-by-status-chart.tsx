"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
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
      name: t(STATUS_LABEL_KEYS[d.status] ?? "") || d.status,
      value: d.count,
      status: d.status,
    }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={3}
          dataKey="value"
        >
          {chartData.map((entry) => (
            <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "var(--chart-pending)"} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number) => [value, t("charts.paymentsTooltip")]}
          contentStyle={{ borderRadius: 10, border: "1px solid var(--color-border)", boxShadow: "var(--shadow-dropdown)" }}
        />
        <Legend
          formatter={(value) => <span className="text-xs text-text-secondary">{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
