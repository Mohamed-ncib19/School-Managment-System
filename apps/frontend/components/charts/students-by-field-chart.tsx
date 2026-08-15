"use client";

import { BarChartSvg } from "./svg-charts";
import { useTranslation } from "@/lib/i18n/context";

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-1)",
];

interface StudentsByFieldChartProps {
  data: { field: string; count: number }[];
}

export function StudentsByFieldChart({ data }: StudentsByFieldChartProps) {
  const { t } = useTranslation();
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-text-secondary">
        {t("charts.noFieldData")}
      </div>
    );
  }

  return (
    <BarChartSvg
      data={data.map((d) => ({ label: d.field, value: d.count }))}
      colors={COLORS}
      formatValue={(v) => String(v)}
      formatTick={(v) => String(v)}
      ariaLabel={t("dashboard.studentsPerField")}
    />
  );
}