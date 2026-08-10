import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { PaymentStatus } from "@/types";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

interface CurrencyConfig {
  currency: string;
  locale: string;
}

/**
 * Money formatting follows the academy's configured currency (Financial
 * Management > Settings), not a hard-coded TND. The config is a module-level
 * value the CurrencyConfigProvider seeds once settings load, so every money
 * cell in the app reformats on the next render without threading a hook
 * through each caller.
 */
let currencyConfig: CurrencyConfig = { currency: "TND", locale: "fr-TN" };

export function setCurrencyConfig(config: CurrencyConfig) {
  currencyConfig = config;
}

export function formatCurrency(value: number | string): string {
  if (value === null || value === undefined) return "-";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "-";
  return new Intl.NumberFormat(currencyConfig.locale, {
    style: "currency",
    currency: currencyConfig.currency,
  }).format(num);
}

export interface FeeSource {
  assignments?: Array<{ fee?: string | number | null }> | null;
  monthly_fee?: string | number | null;
}

/**
 * The student's monthly commitment: the sum of per-enrollment fees when the
 * student has assignment rows, otherwise the legacy single monthly fee.
 */
export function studentTotalFee(student: FeeSource): number {
  const fees = (student.assignments ?? [])
    .map((a) => Number(a.fee))
    .filter((n) => Number.isFinite(n));
  if (fees.length) return fees.reduce((sum, n) => sum + n, 0);
  return Number(student.monthly_fee ?? 0) || 0;
}

export function formatDate(date: string | Date): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function formatPeriod(period: string): string {
  const [year, month] = period.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

export function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Tinted background/text/border classes per payment status (§9.12).
 * Single source of truth for status colour so badges, rows and charts agree.
 *
 * Every status has its own colour — anything grey means "no status was given":
 *   paid → green, partially_paid → amber, due_soon → yellow, overdue → red,
 *   not_paid → blue, cancelled → grey (struck through).
 */
export function getPaymentStatusColorLight(status: PaymentStatus | string): string {
  switch (status) {
    case "paid":
      return "bg-success-soft text-success-strong border-success/30";
    case "partially_paid":
      return "bg-warning-soft text-warning-strong border-warning/30";
    case "due_soon":
      return "bg-gold-50 text-gold-700 border-gold-200";
    case "overdue":
      return "bg-danger-soft text-danger-strong border-danger/30";
    case "cancelled":
      return "bg-danger-soft text-danger-strong border-danger/30 line-through";
    default:
      return "bg-primary-50 text-primary-700 border-primary/30";
  }
}
