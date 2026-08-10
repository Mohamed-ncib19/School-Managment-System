"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/format";

type Tone = "neutral" | "positive" | "warning" | "danger" | "brand";

const TONE_STYLES: Record<Tone, { icon: string; value: string }> = {
  neutral: { icon: "bg-neutral-soft text-neutral-strong", value: "text-text-primary" },
  brand: { icon: "bg-primary-50 text-primary", value: "text-text-primary" },
  positive: { icon: "bg-success-soft text-success-strong", value: "text-success-strong" },
  warning: { icon: "bg-gold-50 text-gold-700", value: "text-gold-700" },
  danger: { icon: "bg-danger-soft text-danger-strong", value: "text-danger-strong" },
};

interface KpiCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: Tone;
  /** Secondary line — a count, a period, the other half of a split. */
  hint?: string;
  /** Optional 0-100 meter, for rate-style cards. */
  meter?: number;
  loading?: boolean;
  /** Link to the screen that acts on this figure, when there is a clear one. */
  href?: string;
}

/**
 * A single headline figure.
 *
 * The number is the point, so it carries the visual weight and everything else
 * recedes. The tone tints the icon and the value only — never the card body,
 * which would turn a dashboard of eight cards into a traffic light.
 */
export function KpiCard({ label, value, icon: Icon, tone = "neutral", hint, meter, loading, href }: KpiCardProps) {
  const styles = TONE_STYLES[tone];

  const body = (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className={cn("h-10 w-10 shrink-0 rounded-btn flex items-center justify-center", styles.icon)}>
          <Icon size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-text-secondary truncate">{label}</p>
          {loading ? (
            <div className="mt-1 h-7 w-24 rounded bg-neutral-soft animate-pulse" />
          ) : (
            <p className={cn("text-h4 font-bold tabular-nums truncate", styles.value)} title={value}>
              {value}
            </p>
          )}
          {hint && !loading && <p className="text-xs text-text-secondary mt-0.5 truncate">{hint}</p>}
        </div>
      </div>

      {meter !== undefined && !loading && (
        <div>
          <div className="h-1.5 w-full rounded-full bg-neutral-soft overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300",
                meter >= 80 ? "bg-success" : meter >= 50 ? "bg-gold" : "bg-danger",
              )}
              style={{ width: `${Math.min(Math.max(meter, 0), 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="card flex flex-col gap-3 transition-colors hover:border-primary/50">
        {body}
      </Link>
    );
  }

  return <div className="card flex flex-col gap-3">{body}</div>;
}
