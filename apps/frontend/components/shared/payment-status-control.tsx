"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlarmClock,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Loader2,
  Receipt,
} from "lucide-react";
import { useUpdatePaymentStatus } from "@/hooks/use-payments";
import { cn, getPaymentStatusColorLight } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";
import type { PaymentStatus } from "@/types";

/**
 * The states this control sets directly. `paid` is deliberately absent: marking
 * a payment paid has to capture who took the cash, when, and how much, which
 * only the record-payment flow does — the API rejects `paid` on the status
 * endpoint. Settling a payment is offered here as its own action instead.
 */
const SETTABLE: { value: Exclude<PaymentStatus, "paid">; labelKey: string; icon: React.ReactNode }[] = [
  { value: "not_paid", labelKey: "payments.notPaid", icon: <Circle size={13} aria-hidden="true" /> },
  { value: "due_soon", labelKey: "payments.dueSoon", icon: <AlarmClock size={13} aria-hidden="true" /> },
  { value: "overdue", labelKey: "payments.overdue", icon: <AlertTriangle size={13} aria-hidden="true" /> },
];

const CURRENT_ICON: Record<PaymentStatus, React.ReactNode> = {
  paid: <CheckCircle2 size={12} aria-hidden="true" />,
  due_soon: <AlarmClock size={12} aria-hidden="true" />,
  not_paid: <Circle size={12} aria-hidden="true" />,
  overdue: <AlertTriangle size={12} aria-hidden="true" />,
};

const STATUS_LABEL_KEY: Record<PaymentStatus, string> = {
  paid: "payments.paid",
  due_soon: "payments.dueSoon",
  not_paid: "payments.notPaid",
  overdue: "payments.overdue",
};

interface PaymentStatusControlProps {
  paymentId: string;
  status: PaymentStatus;
  /** Opens the record-payment modal — the only route to `paid`. */
  onRecordPayment?: () => void;
}

/**
 * The status badge *is* the control: click it to change the status. This
 * replaces a pencil icon that opened a hover-only menu — unreachable by
 * keyboard, impossible on touch, and offering a `paid` option the API refuses.
 */
export function PaymentStatusControl({ paymentId, status, onRecordPayment }: PaymentStatusControlProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState("");
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const mutation = useUpdatePaymentStatus();

  // Anchored with `position: fixed` against the trigger's rect rather than
  // absolutely inside the row: the table scrolls in an overflow container,
  // which would otherwise clip the menu.
  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const MENU_HEIGHT = 190;
    const openUpwards = rect.bottom + MENU_HEIGHT > window.innerHeight;
    setCoords({
      top: openUpwards ? rect.top - MENU_HEIGHT - 4 : rect.bottom + 4,
      left: rect.left,
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    // A scroll would leave the fixed menu stranded away from its row.
    const onScroll = () => setIsOpen(false);

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [isOpen]);

  const changeStatus = (next: Exclude<PaymentStatus, "paid">) => {
    setError("");
    mutation.mutate(
      { paymentId, status: next },
      {
        onSuccess: () => setIsOpen(false),
        onError: (err: any) =>
          setError(
            err?.response?.data?.error?.message ??
              t("payments.statusChangeFailed", "Could not change the status"),
          ),
      },
    );
  };

  const label = t(STATUS_LABEL_KEY[status]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setError("");
          setIsOpen((open) => !open);
        }}
        disabled={mutation.isPending}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t("payments.changeStatusFor", "Change payment status") + `: ${label}`}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-caption font-medium",
          "transition-shadow hover:shadow-card focus:outline-none focus:ring-2 focus:ring-primary/40",
          "disabled:opacity-60 disabled:cursor-wait",
          getPaymentStatusColorLight(status),
        )}
      >
        {mutation.isPending ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : CURRENT_ICON[status]}
        {label}
        <ChevronDown size={12} aria-hidden="true" className={cn("transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          style={{ top: coords.top, left: coords.left }}
          className="fixed z-50 min-w-[190px] rounded-btn border border-border bg-surface py-1 shadow-hover"
        >
          {SETTABLE.map((option) => {
            const isCurrent = option.value === status;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitem"
                onClick={() => !isCurrent && changeStatus(option.value)}
                disabled={isCurrent || mutation.isPending}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors",
                  "hover:bg-background disabled:cursor-default",
                  isCurrent ? "font-semibold text-text-primary bg-background" : "text-text-secondary hover:text-text-primary",
                )}
              >
                {option.icon}
                <span className="flex-1">{t(option.labelKey)}</span>
                {isCurrent && <Check size={13} aria-hidden="true" className="text-primary" />}
              </button>
            );
          })}

          {status !== "paid" && onRecordPayment && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsOpen(false);
                  onRecordPayment();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-success-strong transition-colors hover:bg-background"
              >
                <Receipt size={13} aria-hidden="true" />
                {t("payments.recordPayment")}
              </button>
            </>
          )}

          {error && (
            <p role="alert" className="px-3 py-2 text-xs text-danger border-t border-border">
              {error}
            </p>
          )}
        </div>
      )}
    </>
  );
}
