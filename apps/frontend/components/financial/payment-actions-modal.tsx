"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Ban, Printer, RotateCcw, Tag, Undo2, Wallet, X } from "lucide-react";
import {
  useCancelPayment,
  useCorrectPayment,
  useRecordTransaction,
  useRefundPayment,
  useReopenPayment,
  useUpdatePaymentStatus,
} from "@/hooks/use-financial";
import { openReceipt } from "@/lib/api/financial.api";
import { statusClasses } from "@/lib/charts/theme";
import { cn, formatCurrency, formatDate, formatPeriod } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";
import type { StudentPayment } from "@/types";

type Mode = "pay" | "refund" | "correct" | "cancel";

const MANUAL_STATUSES = ["not_paid", "due_soon", "overdue", "paid", "partially_paid", "cancelled"] as const;

interface PaymentActionsModalProps {
  payment: StudentPayment;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Everything that can happen to one invoice, in one place.
 *
 * Take a payment, refund one, correct a keying error, void the invoice, print
 * the receipt — plus the full ledger, so the person deciding what to do can see
 * what has already happened. Splitting these across four modals would mean four
 * places that each show a different subset of the same history.
 */
export function PaymentActionsModal({ payment, isOpen, onClose }: PaymentActionsModalProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("pay");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [overrideStatus, setOverrideStatus] = useState<string>(payment.status);
  const [overrideReason, setOverrideReason] = useState("");

  const record = useRecordTransaction();
  const refund = useRefundPayment();
  const correct = useCorrectPayment();
  const cancel = useCancelPayment();
  const reopen = useReopenPayment();
  const statusUpdate = useUpdatePaymentStatus();

  const outstanding = Number(payment.remaining_balance);
  const collected = Number(payment.paid_amount ?? "0");
  const isCancelled = payment.status === "cancelled";

  // Reset each time a different invoice is opened, or a stale amount from the
  // last one carries over into this one.
  useEffect(() => {
    if (!isOpen) return;
    setMode(isCancelled ? "cancel" : "pay");
    setAmount(outstanding > 0 ? outstanding.toFixed(2) : "");
    setReason("");
    setNotes("");
    setOverrideStatus(payment.status);
    setOverrideReason("");
    setError(null);
  }, [isOpen, payment.id, outstanding, isCancelled]);

  const pending =
    record.isPending || refund.isPending || correct.isPending || cancel.isPending || reopen.isPending || statusUpdate.isPending;

  if (!isOpen) return null;

  const fail = (err: unknown) => {
    const message =
      (err as any)?.response?.data?.error?.message ??
      (err as any)?.response?.data?.message ??
      (err as Error)?.message ??
      t("common.somethingWentWrong", "Something went wrong");
    setError(Array.isArray(message) ? message.join(", ") : String(message));
  };

  const submit = async () => {
    setError(null);
    try {
      const statusChanged = overrideStatus !== payment.status;
      // A manual status change is the whole intent — skip the money action so
      // Confirm cannot take a payment (or re-take a settled one) nobody asked
      // for. The "record payment" mode only runs on its own.
      if (!statusChanged) {
        if (mode === "pay") {
          await record.mutateAsync({ id: payment.id, amount: amount || undefined, notes: notes || undefined });
        } else if (mode === "refund") {
          if (!reason.trim()) return setError(t("financial.reasonRequired", "A reason is required"));
          await refund.mutateAsync({ id: payment.id, amount, reason, notes: notes || undefined });
        } else if (mode === "correct") {
          if (!reason.trim()) return setError(t("financial.reasonRequired", "A reason is required"));
          await correct.mutateAsync({ id: payment.id, amount, reason, notes: notes || undefined });
        } else if (mode === "cancel") {
          if (!reason.trim()) return setError(t("financial.reasonRequired", "A reason is required"));
          await cancel.mutateAsync({ id: payment.id, reason });
        }
      }
      // The manual status selection is applied by the same Confirm button —
      // there is no separate "Apply" step for it.
      if (statusChanged) {
        await statusUpdate.mutateAsync({
          id: payment.id,
          status: overrideStatus,
          reason: overrideReason.trim() || undefined,
        });
      }
      onClose();
    } catch (err) {
      fail(err);
    }
  };

  const handleReopen = async () => {
    setError(null);
    try {
      await reopen.mutateAsync({ id: payment.id });
      onClose();
    } catch (err) {
      fail(err);
    }
  };

  const handlePrint = async () => {
    try {
      await openReceipt("payment", payment.id);
    } catch {
      setError(t("financial.popupBlocked", "Allow pop-ups to print the receipt."));
    }
  };

  const TABS: { mode: Mode; label: string; icon: typeof Wallet; disabled?: boolean }[] = [
    { mode: "pay", label: t("financial.recordPayment", "Record payment"), icon: Wallet, disabled: isCancelled || outstanding <= 0 },
    { mode: "refund", label: t("financial.refund", "Refund"), icon: Undo2, disabled: isCancelled || collected <= 0 },
    { mode: "correct", label: t("financial.correct", "Correct"), icon: RotateCcw, disabled: isCancelled },
    { mode: "cancel", label: t("financial.cancel", "Cancel invoice"), icon: Ban, disabled: isCancelled || collected > 0 },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("financial.managePayment", "Manage payment")}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-surface rounded-modal shadow-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-thin">
        <div className="flex items-start justify-between p-5 border-b border-border sticky top-0 bg-surface z-10">
          <div>
            <h3 className="text-sm font-bold text-text-primary">
              {payment.context.student_name ?? t("payments.studentName", "Student")}
            </h3>
            <p className="text-xs text-text-secondary mt-0.5">
              {formatPeriod(payment.period)} &middot; {payment.context.group?.name ?? "—"} &middot;{" "}
              {payment.context.professor?.name ?? "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close", "Close")}
            className="text-text-secondary hover:text-text-primary p-1"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Figure label={t("payments.amountDue", "Amount due")} value={formatCurrency(payment.amount_due)} />
            <Figure label={t("financial.collected", "Collected")} value={formatCurrency(collected)} tone="positive" />
            <Figure
              label={t("financial.remainingBalance", "Remaining")}
              value={formatCurrency(outstanding)}
              tone={outstanding > 0 ? "danger" : "neutral"}
            />
            <div>
              <p className="text-xs text-text-secondary">{t("payments.status", "Status")}</p>
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium mt-1",
                  statusClasses(payment.status),
                )}
              >
                {t(`payments.statuses.${payment.status}`, payment.status.replace(/_/g, " "))}
              </span>
            </div>
          </div>

          {payment.transactions.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-text-secondary uppercase mb-2">
                {t("financial.ledger", "Ledger")}
              </h4>
              <div className="rounded-table border border-border overflow-hidden">
                <table className="min-w-full text-xs">
                  <tbody className="divide-y divide-border">
                    {[...payment.transactions]
                      .sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime())
                      .map((transaction) => (
                      <tr key={transaction.id}>
                        <td className="px-3 py-2 text-text-secondary">{formatDate(transaction.paid_at)}</td>
                        <td className="px-3 py-2">
                          <span className="text-text-primary">
                            {t(`financial.txn.${transaction.type}`, transaction.type)}
                          </span>
                          {transaction.reason && (
                            <span className="text-text-secondary block">{transaction.reason}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-text-secondary font-mono">
                          {transaction.receipt_number ?? "—"}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right tabular-nums font-medium",
                            Number(transaction.amount) < 0 ? "text-danger-strong" : "text-success-strong",
                          )}
                        >
                          {formatCurrency(transaction.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!isCancelled && (
            <div className="rounded-btn border border-border bg-background p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Tag size={13} className="text-text-secondary" aria-hidden="true" />
                <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  {t("financial.manualStatus", "Manual status")}
                </h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  aria-label={t("payments.status", "Status")}
                  value={overrideStatus}
                  onChange={(e) => setOverrideStatus(e.target.value)}
                  className="input w-full text-xs"
                >
                  {MANUAL_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {t(`payments.statuses.${status}`, status.replace(/_/g, " "))}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder={t("financial.statusReasonPlaceholder", "Reason (optional)")}
                  className="input w-full text-xs"
                />
              </div>
              <p className="text-xs text-text-secondary">
                {t(
                  "financial.statusHint",
                  "Pick any status; the selected one is applied when you click Confirm and every change is recorded in the audit log.",
                )}
              </p>
            </div>
          )}

          {isCancelled ? (
            <div className="rounded-btn border border-border bg-background p-4 space-y-3">
              <p className="text-sm text-text-secondary">
                {t("financial.invoiceCancelled", "This invoice is cancelled.")}
              </p>
              <button type="button" onClick={handleReopen} disabled={pending} className="btn btn-secondary text-xs">
                <RotateCcw size={14} aria-hidden="true" />
                {t("financial.reopen", "Reopen invoice")}
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1 flex-wrap border-b border-border -mb-px">
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.mode}
                      type="button"
                      disabled={tab.disabled}
                      onClick={() => {
                        setMode(tab.mode);
                        setError(null);
                        setAmount(tab.mode === "pay" && outstanding > 0 ? outstanding.toFixed(2) : "");
                      }}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
                        mode === tab.mode
                          ? "border-primary text-primary"
                          : "border-transparent text-text-secondary hover:text-text-primary",
                        tab.disabled && "opacity-40 cursor-not-allowed",
                      )}
                    >
                      <Icon size={13} aria-hidden="true" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="space-y-3">
                {mode !== "cancel" && (
                  <div>
                    <label htmlFor="txn-amount" className="text-xs text-text-secondary block mb-1">
                      {mode === "correct"
                        ? t("financial.adjustment", "Adjustment (negative to reduce)")
                        : t("payments.amount", "Amount")}
                    </label>
                    <input
                      id="txn-amount"
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={mode === "pay" ? outstanding.toFixed(2) : "0.00"}
                      className="input w-full"
                    />
                    {mode === "pay" && (
                      <p className="text-xs text-text-secondary mt-1">
                        {t("financial.partialHint", "Leave as-is to settle in full, or enter less for a partial payment.")}
                      </p>
                    )}
                  </div>
                )}

                {mode !== "pay" && (
                  <div>
                    <label htmlFor="txn-reason" className="text-xs text-text-secondary block mb-1">
                      {t("financial.reason", "Reason")} <span className="text-danger">*</span>
                    </label>
                    <input
                      id="txn-reason"
                      type="text"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="input w-full"
                    />
                  </div>
                )}

                {mode !== "cancel" && (
                  <div>
                    <label htmlFor="txn-notes" className="text-xs text-text-secondary block mb-1">
                      {t("payments.notes", "Notes")}
                    </label>
                    <textarea
                      id="txn-notes"
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="input w-full resize-none"
                    />
                  </div>
                )}
              </div>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-btn bg-danger-soft text-danger-strong px-3 py-2 text-xs">
              <AlertCircle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 p-5 border-t border-border sticky bottom-0 bg-surface">
          <button
            type="button"
            onClick={handlePrint}
            disabled={payment.transactions.length === 0}
            className="btn btn-secondary text-xs disabled:opacity-40"
          >
            <Printer size={14} aria-hidden="true" />
            {t("financial.printReceipt", "Print receipt")}
          </button>

          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn btn-secondary text-xs">
              {t("common.cancel", "Close")}
            </button>
            {!isCancelled && (
              <button type="button" onClick={submit} disabled={pending} className="btn btn-primary text-xs">
                {pending ? t("common.saving", "Saving…") : t("common.confirm", "Confirm")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "danger";
}) {
  return (
    <div>
      <p className="text-xs text-text-secondary">{label}</p>
      <p
        className={cn(
          "text-sm font-bold tabular-nums mt-1",
          tone === "positive" && "text-success-strong",
          tone === "danger" && "text-danger-strong",
          tone === "neutral" && "text-text-primary",
        )}
      >
        {value}
      </p>
    </div>
  );
}
