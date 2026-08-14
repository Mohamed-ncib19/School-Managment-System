"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
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
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="field" tick={{ fontSize: 12, fill: "var(--chart-axis)" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 12, fill: "var(--chart-axis)" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          formatter={(value: number) => [value, t("charts.studentsTooltip")]}
          contentStyle={{ borderRadius: 10, border: "1px solid var(--color-border)", boxShadow: "var(--shadow-dropdown)" }}
        />
        <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={48}>
          {data.map((_, index) => (
            <Cell key={index} fill={COLORS[index % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
