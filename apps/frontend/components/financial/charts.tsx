"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  AXIS_PROPS,
  BAR_RADIUS,
  CHROME,
  GRID_PROPS,
  LINE_WIDTH,
  STATUS_COLOR,
  compactAmount,
  formatBucket,
} from "@/lib/charts/theme";
import { ChartTooltip } from "./chart-tooltip";

const CHART_HEIGHT = 260;

export interface SeriesSpec {
  key: string;
  label: string;
  color: string;
}

/**
 * Recharts renders SVG, so the CSS custom properties in the design tokens reach
 * `fill` and `stroke` directly — which is what keeps chart colour in the token
 * file rather than scattered through these components.
 */

interface TimeSeriesProps {
  data: Record<string, unknown>[];
  series: SeriesSpec[];
  countKeys?: string[];
  percentKeys?: string[];
  /** Stacked area reads better for parts-of-a-whole; lines for comparison. */
  variant?: "line" | "area" | "stacked-area";
}

export function TimeSeriesChart({
  data,
  series,
  countKeys,
  percentKeys,
  variant = "line",
}: TimeSeriesProps) {
  const rows = data.map((row) => {
    const next: Record<string, unknown> = { bucket: row.bucket };
    for (const spec of series) next[spec.key] = Number(row[spec.key] ?? 0);
    return next;
  });

  const tooltip = (
    <Tooltip
      content={<ChartTooltip countKeys={countKeys} percentKeys={percentKeys} />}
      cursor={{ stroke: CHROME.axis, strokeWidth: 1, strokeDasharray: "3 3" }}
    />
  );

  if (variant === "line") {
    return (
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="bucket" tickFormatter={formatBucket} {...AXIS_PROPS} />
          <YAxis tickFormatter={compactAmount} width={52} {...AXIS_PROPS} />
          {tooltip}
          {series.map((spec) => (
            <Line
              key={spec.key}
              type="monotone"
              dataKey={spec.key}
              name={spec.label}
              stroke={spec.color}
              strokeWidth={LINE_WIDTH}
              dot={false}
              // Bigger than the mark, so the hover target is reachable.
              activeDot={{ r: 5, strokeWidth: 2, stroke: CHROME.surface }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
        <defs>
          {series.map((spec) => (
            <linearGradient key={spec.key} id={`fill-${spec.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={spec.color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={spec.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="bucket" tickFormatter={formatBucket} {...AXIS_PROPS} />
        <YAxis tickFormatter={compactAmount} width={52} {...AXIS_PROPS} />
        {tooltip}
        {series.map((spec) => (
          <Area
            key={spec.key}
            type="monotone"
            dataKey={spec.key}
            name={spec.label}
            stroke={spec.color}
            strokeWidth={LINE_WIDTH}
            fill={`url(#fill-${spec.key})`}
            stackId={variant === "stacked-area" ? "stack" : undefined}
            activeDot={{ r: 5, strokeWidth: 2, stroke: CHROME.surface }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

interface GroupedBarProps {
  data: Record<string, unknown>[];
  series: SeriesSpec[];
  countKeys?: string[];
}

export function GroupedBarChart({ data, series, countKeys }: GroupedBarProps) {
  const rows = data.map((row) => {
    const next: Record<string, unknown> = { bucket: row.bucket };
    for (const spec of series) next[spec.key] = Number(row[spec.key] ?? 0);
    return next;
  });

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 4 }} barGap={2}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="bucket" tickFormatter={formatBucket} {...AXIS_PROPS} />
        <YAxis tickFormatter={compactAmount} width={52} {...AXIS_PROPS} />
        <Tooltip
          content={<ChartTooltip countKeys={countKeys} />}
          cursor={{ fill: CHROME.grid, fillOpacity: 0.35 }}
        />
        {series.map((spec) => (
          <Bar
            key={spec.key}
            dataKey={spec.key}
            name={spec.label}
            fill={spec.color}
            radius={BAR_RADIUS}
            maxBarSize={28}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

interface BreakdownBarProps {
  data: { name: string; revenue: string; id?: string | null }[];
  color: string;
  label: string;
  onSelect?: (row: { name: string; id?: string | null }) => void;
}

/**
 * Horizontal bars for a dimensional breakdown.
 *
 * Horizontal because the categories are names — "Terminale Sciences" as a
 * rotated x-axis tick is unreadable, and truncating it loses the identity the
 * chart exists to show. One series, so no legend: the title names it.
 */
export function BreakdownBarChart({ data, color, label, onSelect }: BreakdownBarProps) {
  const rows = data.map((row) => ({ ...row, value: Number(row.revenue) }));
  const height = Math.max(CHART_HEIGHT, rows.length * 34 + 40);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={CHROME.grid} horizontal={false} />
        <XAxis type="number" tickFormatter={compactAmount} {...AXIS_PROPS} />
        <YAxis
          type="category"
          dataKey="name"
          width={130}
          {...AXIS_PROPS}
          tick={{ fill: CHROME.text, fontSize: 11 }}
        />
        <Tooltip content={<ChartTooltip labelFormatter={(value) => value} />} cursor={{ fill: CHROME.grid, fillOpacity: 0.35 }} />
        <Bar
          dataKey="value"
          name={label}
          fill={color}
          radius={[0, 4, 4, 0]}
          maxBarSize={22}
          cursor={onSelect ? "pointer" : undefined}
          onClick={(entry: any) => onSelect?.({ name: entry?.name, id: entry?.id })}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

interface StatusDonutProps {
  data: { status: string; count: number; label: string }[];
}

/**
 * Payment states as a donut.
 *
 * Legitimate here where it usually is not: these are parts of one whole, there
 * are at most six of them, and each slice is directly labelled with its count —
 * so the reader is never asked to compare angles by eye. A 2px surface-coloured
 * ring separates adjacent slices.
 */
export function StatusDonutChart({ data }: StatusDonutProps) {
  const total = data.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="flex items-center gap-6 flex-wrap">
      <ResponsiveContainer width={200} height={200}>
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="label"
            innerRadius={58}
            outerRadius={88}
            paddingAngle={2}
            stroke={CHROME.surface}
            strokeWidth={2}
          >
            {data.map((row) => (
              <Cell key={row.status} fill={STATUS_COLOR[row.status] ?? CHROME.axis} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip countKeys={data.map((d) => "count")} labelFormatter={(v) => v} />} />
        </PieChart>
      </ResponsiveContainer>

      {/* Direct labels: identity and magnitude without reading the ring. */}
      <ul className="space-y-2 min-w-[160px] flex-1">
        {data.map((row) => (
          <li key={row.status} className="flex items-center justify-between gap-4 text-sm">
            <span className="inline-flex items-center gap-2 text-text-secondary">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: STATUS_COLOR[row.status] ?? CHROME.axis }}
              />
              {row.label}
            </span>
            <span className="tabular-nums font-medium text-text-primary">
              {row.count}
              <span className="text-text-secondary font-normal ml-1.5 text-xs">
                {total > 0 ? `${Math.round((row.count / total) * 100)}%` : "0%"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
