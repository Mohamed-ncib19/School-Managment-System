"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Zero-dependency SVG chart primitives.
 *
 * The dashboard's three charts used recharts, which pulls the whole d3 tree
 * into the /dashboard route graph — that dominated the route's compile time
 * and client bundle. These primitives cover the exact shapes the dashboard
 * needs (bars + donut) with plain SVG, keeping the look (CSS variables,
 * rounded bars, hover tooltips) while dropping every chart dependency.
 */

function useContainerWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Rounds a max value up to a 1/2/5 x 10^n number so axis ticks read cleanly. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const base = Math.pow(10, Math.floor(Math.log10(value)));
  const frac = value / base;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * base;
}

function axisTicks(max: number, count = 4): number[] {
  const step = max / count;
  return Array.from({ length: count + 1 }, (_, i) => Math.round(i * step));
}

function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + rr}`,
    `Q ${x} ${y} ${x + rr} ${y}`,
    `L ${x + w - rr} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + rr}`,
    `L ${x + w} ${y + h}`,
    "Z",
  ].join(" ");
}

function truncate(label: string, max = 12): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export interface BarChartSvgProps {
  data: { label: string; value: number }[];
  height?: number;
  colors?: string[];
  formatValue: (value: number) => string;
  formatTick?: (value: number) => string;
  ariaLabel?: string;
}

export function BarChartSvg({
  data,
  height = 280,
  colors = ["var(--chart-1)"],
  formatValue,
  formatTick,
  ariaLabel,
}: BarChartSvgProps) {
  const [ref, width] = useContainerWidth();
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);

  if (width < 40 || !data.length) {
    return <div ref={ref} style={{ height }} className="w-full" />;
  }

  const margin = { top: 8, right: 8, bottom: 26, left: 46 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const yTicks = axisTicks(max);
  const slot = plotW / data.length;
  const barW = Math.min(40, slot * 0.6);
  const toY = (v: number) => margin.top + plotH * (1 - v / max);

  return (
    <div ref={ref} style={{ height }} className="relative w-full select-none" role="img" aria-label={ariaLabel}>
      <svg width={width} height={height} aria-hidden="true">
        {yTicks.map((tick, i) => {
          const y = toY(tick);
          return (
            <g key={i}>
              <line
                x1={margin.left}
                x2={width - margin.right}
                y1={y}
                y2={y}
                stroke="var(--chart-grid)"
                strokeDasharray="3 3"
              />
              <text
                x={margin.left - 6}
                y={y + 4}
                textAnchor="end"
                fontSize={12}
                fill="var(--chart-axis)"
              >
                {formatTick ? formatTick(tick) : String(tick)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = margin.left + i * slot + (slot - barW) / 2;
          const y = toY(d.value);
          return (
            <path
              key={i}
              d={roundedTopBar(x, y, barW, margin.top + plotH - y, 6)}
              fill={colors[i % colors.length]}
              onMouseEnter={() => setHover({ index: i, x: x + barW / 2, y: Math.max(y, margin.top) })}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
        {data.map((d, i) => (
          <text
            key={i}
            x={margin.left + i * slot + slot / 2}
            y={height - 8}
            textAnchor="middle"
            fontSize={12}
            fill="var(--chart-axis)"
          >
            {truncate(d.label)}
          </text>
        ))}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border px-2.5 py-1.5 text-xs shadow-sm"
          style={{
            left: Math.min(Math.max(hover.x - 50, 0), width - 110),
            top: Math.max(hover.y - 52, 2),
            borderColor: "var(--color-border)",
            boxShadow: "var(--shadow-dropdown)",
            background: "var(--surface)",
            color: "var(--text-primary)",
          }}
        >
          <div className="font-semibold">{data[hover.index].label}</div>
          <div className="text-text-secondary">{formatValue(data[hover.index].value)}</div>
        </div>
      )}
    </div>
  );
}

export interface DonutChartSvgProps {
  data: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  formatValue: (value: number) => string;
  ariaLabel?: string;
}

export function DonutChartSvg({
  data,
  size = 150,
  thickness = 26,
  formatValue,
  ariaLabel,
}: DonutChartSvgProps) {
  const [hover, setHover] = useState<number | null>(null);

  if (!data.length) return <div style={{ height: size + 40 }} className="w-full" />;

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const GAP = 2;

  let offset = 0;
  const segments = data.map((d) => {
    const frac = total > 0 ? d.value / total : 0;
    const len = Math.max(0, frac * circumference - GAP);
    const seg = { ...d, dash: `${len} ${circumference - len}`, offset: -offset };
    offset += frac * circumference;
    return seg;
  });

  const hovered = hover !== null ? data[hover] : null;
  const hoveredPct = hovered && total > 0 ? Math.round((hovered.value / total) * 100) : 0;

  return (
    <div className="flex w-full flex-col items-center" role="img" aria-label={ariaLabel}>
      <div className="relative">
        <svg width={size} height={size} aria-hidden="true">
          {segments.map((seg, i) => (
            <circle
              key={i}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={thickness}
              strokeDasharray={seg.dash}
              strokeDashoffset={seg.offset}
              transform={`rotate(-90 ${center} ${center})`}
              opacity={hover !== null && hover !== i ? 0.45 : 1}
              className="cursor-pointer transition-opacity"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {hovered ? (
            <>
              <div className="max-w-full truncate px-2 text-xs text-text-secondary">{hovered.label}</div>
              <div className="text-sm font-semibold text-text-primary">
                {formatValue(hovered.value)} ({hoveredPct}%)
              </div>
            </>
          ) : (
            <>
              <div className="text-xl font-bold text-text-primary">{formatValue(total)}</div>
              <div className="text-xs text-text-secondary">Total</div>
            </>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {data.map((d, i) => (
          <div
            key={i}
            className="flex cursor-pointer items-center gap-1.5 text-xs text-text-secondary"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}