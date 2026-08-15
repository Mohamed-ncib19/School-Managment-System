"use client";

import { BarChartSvg } from "./svg-charts";
import { formatCurrency } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-1)",
];

interface RevenueChartProps {
  data: { month: string; revenue: number }[];
}

export function RevenueChart({ data }: RevenueChartProps) {
  const { t } = useTranslation();
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-text-secondary">
        {t("charts.noRevenueData")}
      </div>
    );
  }

  return (
    <BarChartSvg
      data={data.map((d) => ({ label: d.month, value: d.revenue }))}
      colors={COLORS}
      formatValue={formatCurrency}
      formatTick={(v) => `$${v}`}
      ariaLabel={t("dashboard.revenueByMonth")}
    />
  );
}