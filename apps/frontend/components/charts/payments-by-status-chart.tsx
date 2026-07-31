"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

const STATUS_COLORS: Record<string, string> = {
  paid: "#22C55E",
  due_soon: "#F5B940",
  not_paid: "#9CA3AF",
  overdue: "#EF4444",
};

const STATUS_LABELS: Record<string, string> = {
  paid: "Paid",
  due_soon: "Due Soon",
  not_paid: "Not Paid",
  overdue: "Overdue",
};

interface PaymentsByStatusChartProps {
  data: { status: string; count: number }[];
}

export function PaymentsByStatusChart({ data }: PaymentsByStatusChartProps) {
  if (!data.length || data.every((d) => d.count === 0)) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-text-secondary">
        No payment data available
      </div>
    );
  }

  const chartData = data
    .filter((d) => d.count > 0)
    .map((d) => ({
      name: STATUS_LABELS[d.status] ?? d.status,
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
            <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#9CA3AF"} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number) => [value, "Payments"]}
          contentStyle={{ borderRadius: 10, border: "1px solid #E5E7EB", boxShadow: "0 4px 16px rgba(0,0,0,0.06)" }}
        />
        <Legend
          formatter={(value) => <span className="text-xs text-text-secondary">{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
