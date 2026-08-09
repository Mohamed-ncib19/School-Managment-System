import type { PaymentStatus } from "@/types";
import { getPaymentStatusColorLight } from "@/lib/utils/format";

/**
 * Chart colours, by the job they do.
 *
 * Every value is a CSS custom property defined in `globals.css`, so charts pick
 * up the light/dark swap from the same tokens as the rest of the UI and no
 * component ever holds a hex literal. SVG attributes accept `var()`, which is
 * what makes this work where a Tailwind class cannot reach.
 */

/**
 * Categorical slots, in fixed order.
 *
 * Assigned by series *identity*, never by rank — `SERIES.revenue` is always slot
 * 1 whatever else is on screen. Cycling these, or handing them out in sort
 * order, would repaint a chart every time a filter changed the series count.
 */
export const CATEGORICAL = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/** The named series this product charts, pinned to their slots. */
export const SERIES = {
  revenue: "var(--chart-1)",
  school: "var(--chart-3)",
  professor: "var(--chart-2)",
  payroll: "var(--chart-4)",
  profit: "var(--chart-5)",
  expected: "var(--chart-4)",
  collected: "var(--chart-1)",
} as const;

/** Single-hue ramp for magnitude. */
export const SEQUENTIAL = [
  "var(--chart-seq-100)",
  "var(--chart-seq-300)",
  "var(--chart-seq-500)",
  "var(--chart-seq-700)",
] as const;

export const CHROME = {
  grid: "var(--chart-grid)",
  axis: "var(--chart-axis)",
  surface: "var(--chart-surface)",
  text: "var(--color-text-secondary)",
  textPrimary: "var(--color-text-primary)",
  border: "var(--color-border)",
} as const;

/** Payment states. Never reused as a series colour. */
export const STATUS_COLOR: Record<string, string> = {
  paid: "var(--chart-paid)",
  partially_paid: "var(--chart-partial)",
  not_paid: "var(--chart-pending)",
  due_soon: "var(--chart-partial)",
  cancelled: "var(--chart-cancelled)",
};

/** Tinted badge classes per status — single colour source lives in `format.ts`. */
export function statusClasses(status: PaymentStatus | string): string {
  return getPaymentStatusColorLight(status);
}

/** Payroll states, reusing the same vocabulary. */
export function payrollStatusClasses(status: string): string {
  switch (status) {
    case "paid":
      return "bg-success-soft text-success-strong border-success/30";
    case "partial":
      return "bg-gold-50 text-gold-700 border-gold-200";
    default:
      return "bg-danger-soft text-danger-strong border-danger/30";
  }
}

/**
 * Shared Recharts geometry.
 *
 * Thin marks and recessive chrome: a 2px line, a hairline grid with no vertical
 * rules, and axis text a step down from body ink. The data should be the
 * heaviest thing in the frame.
 */
export const AXIS_PROPS = {
  stroke: CHROME.axis,
  tick: { fill: CHROME.text, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: CHROME.grid },
} as const;

export const GRID_PROPS = {
  stroke: CHROME.grid,
  strokeDasharray: "0",
  vertical: false,
} as const;

export const LINE_WIDTH = 2;
export const DOT_SIZE = 8;
/** Rounded data-end, anchored to the baseline. */
export const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

/**
 * Turns a bucket key into an axis label.
 *
 * The backend emits keys that sort lexicographically (`2026-08`, `2026-W31`,
 * `2026-Q3`), which keeps the series ordered without parsing; this is where they
 * become readable.
 */
export function formatBucket(bucket: string): string {
  if (/^\d{4}$/.test(bucket)) return bucket;
  if (/^\d{4}-Q\d$/.test(bucket)) return bucket.replace("-", " ");
  if (/^\d{4}-W\d{2}$/.test(bucket)) return `W${bucket.slice(-2)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(bucket)) {
    const [, month, day] = bucket.split("-");
    return `${day}/${month}`;
  }
  if (/^\d{4}-\d{2}$/.test(bucket)) {
    const [year, month] = bucket.split("-");
    return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
    });
  }
  return bucket;
}

/** Compact axis ticks — a y-axis of full dinar figures is unreadable. */
export function compactAmount(value: number): string {
  if (!isFinite(value)) return "0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}
