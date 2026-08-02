"use client";

import { formatCurrency } from "@/lib/utils/format";
import { formatBucket } from "@/lib/charts/theme";

interface TooltipPayloadEntry {
  name?: string;
  dataKey?: string | number;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
  /** Keys rendered as plain numbers rather than money. */
  countKeys?: string[];
  /** Suffix for percentage-style series. */
  percentKeys?: string[];
  labelFormatter?: (label: string) => string;
}

/**
 * The hover layer.
 *
 * Every chart in this product ships one — an HTML chart is interactive by
 * nature, and a revenue figure a reader can only estimate from a y-axis is a
 * figure they will get wrong. Values are right-aligned and tabular so the
 * numbers line up as the pointer moves along a series.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  countKeys = [],
  percentKeys = [],
  labelFormatter,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const counts = new Set(countKeys);
  const percents = new Set(percentKeys);
  const heading = labelFormatter
    ? labelFormatter(String(label ?? ""))
    : formatBucket(String(label ?? ""));

  return (
    <div className="rounded-btn border border-border bg-surface shadow-dropdown px-3 py-2 text-xs min-w-[160px]">
      <p className="font-medium text-text-primary mb-1.5">{heading}</p>
      <div className="space-y-1">
        {payload.map((entry, index) => {
          const key = String(entry.dataKey ?? "");
          const raw = Number(entry.value ?? 0);
          const display = percents.has(key)
            ? `${raw}%`
            : counts.has(key)
              ? raw.toLocaleString()
              : formatCurrency(raw);

          return (
            <div key={`${key}-${index}`} className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-1.5 text-text-secondary">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-sm shrink-0"
                  style={{ backgroundColor: entry.color }}
                />
                {entry.name}
              </span>
              <span className="tabular-nums font-medium text-text-primary">{display}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
