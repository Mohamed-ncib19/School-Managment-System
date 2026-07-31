"use client";

import type { PaymentStatus, StudentStatus } from "@/types";
import { CheckCircle2, AlarmClock, Circle, AlertTriangle, Pause, XCircle } from "lucide-react";
import { cn, getPaymentStatusColorLight } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";

const PAYMENT_STATUS_CONFIG: Record<PaymentStatus, { labelKey: string; icon: React.ReactNode }> = {
  paid: { labelKey: "statusBadge.paid", icon: <CheckCircle2 size={12} aria-hidden="true" /> },
  due_soon: { labelKey: "statusBadge.dueSoon", icon: <AlarmClock size={12} aria-hidden="true" /> },
  not_paid: { labelKey: "statusBadge.pending", icon: <Circle size={12} aria-hidden="true" /> },
  overdue: { labelKey: "statusBadge.overdue", icon: <AlertTriangle size={12} aria-hidden="true" /> },
};

const STUDENT_STATUS_CONFIG: Record<StudentStatus, { labelKey: string; icon: React.ReactNode; color: string }> = {
  active: { labelKey: "statusBadge.active", icon: <CheckCircle2 size={12} aria-hidden="true" />, color: "bg-success-soft text-success-strong dark:bg-success-dark-soft dark:text-success-dark-strong border-success/20 dark:border-success-dark/20" },
  paused: { labelKey: "statusBadge.paused", icon: <Pause size={12} aria-hidden="true" />, color: "bg-warning-soft text-warning-strong dark:bg-warning-dark-soft dark:text-warning-dark-strong border-warning/20 dark:border-warning-dark/20" },
  withdrawn: { labelKey: "statusBadge.withdrawn", icon: <XCircle size={12} aria-hidden="true" />, color: "bg-danger-soft text-danger-strong dark:bg-danger-dark-soft dark:text-danger-dark-strong border-danger/20 dark:border-danger-dark/20" },
};

type StatusType = PaymentStatus | StudentStatus;

function isPaymentStatus(status: StatusType): status is PaymentStatus {
  return ["paid", "due_soon", "not_paid", "overdue"].includes(status);
}

export function StatusBadge({ status }: { status: StatusType }) {
  const { t } = useTranslation();

  if (isPaymentStatus(status)) {
    const config = PAYMENT_STATUS_CONFIG[status] ?? PAYMENT_STATUS_CONFIG.not_paid;
    const label = t(config.labelKey);
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-caption font-medium",
          getPaymentStatusColorLight(status),
        )}
        role="status"
        aria-label={`Payment status: ${label}`}
      >
        {config.icon}
        {label}
      </span>
    );
  }

  const config = STUDENT_STATUS_CONFIG[status] ?? STUDENT_STATUS_CONFIG.active;
  const label = t(config.labelKey);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-caption font-medium",
        config.color,
      )}
      role="status"
      aria-label={`Student status: ${label}`}
    >
      {config.icon}
      {label}
    </span>
  );
}
