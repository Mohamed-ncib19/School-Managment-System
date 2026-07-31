import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { PaymentStatus } from "@/types";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | string): string {
  if (value === null || value === undefined) return "-";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "-";
  return new Intl.NumberFormat("fr-TN", { style: "currency", currency: "TND" }).format(num);
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
 */
export function getPaymentStatusColorLight(status: PaymentStatus | string): string {
  switch (status) {
    case "paid":
      return "bg-success-soft text-success-strong border-success/30";
    case "due_soon":
      return "bg-gold-50 text-gold-700 border-gold-200";
    case "overdue":
      return "bg-danger-soft text-danger-strong border-danger/30";
    default:
      return "bg-neutral-soft text-neutral-strong border-border";
  }
}
