"use client";

import { useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { useRecordPayroll } from "@/hooks/use-financial";
import { formatCurrency, formatPeriod } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";

interface RecordPayrollModalProps {
  profId: string;
  professorName: string;
  period: string;
  outstanding: string;
  isOpen: boolean;
  onClose: () => void;
  /** Called with the recorded payout so the caller can show its settlement papers. */
  onSettled?: (payout: { id: string }) => void;
}

/**
 * Hands money to a professor.
 *
 * Defaults to the full outstanding balance but accepts less, which is what makes
 * a part-payment possible; the server refuses more than is owed, so an
 * overpayment cannot leave a negative balance sitting in the books.
 */
export function RecordPayrollModal({
  profId,
  professorName,
  period,
  outstanding,
  isOpen,
  onClose,
  onSettled,
}: RecordPayrollModalProps) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(Number(outstanding).toFixed(2));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const record = useRecordPayroll();

  if (!isOpen) return null;

  const submit = async () => {
    setError(null);
    try {
      const payout = await record.mutateAsync({ profId, amount, period, notes: notes || undefined });
      onClose();
      onSettled?.(payout as { id: string });
    } catch (err) {
      const message =
        (err as any)?.response?.data?.error?.message ??
        (err as any)?.response?.data?.message ??
        (err as Error)?.message ??
        t("common.somethingWentWrong", "Something went wrong");
      setError(Array.isArray(message) ? message.join(", ") : String(message));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("financial.recordPayroll", "Record payment")}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-surface rounded-modal shadow-modal w-full max-w-md">
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div>
            <h3 className="text-sm font-bold text-text-primary">
              {t("financial.recordPayroll", "Record payment")}
            </h3>
            <p className="text-xs text-text-secondary mt-0.5">
              {professorName} &middot; {formatPeriod(period)}
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

        <div className="p-5 space-y-4">
          <div className="rounded-btn bg-background p-3">
            <p className="text-xs text-text-secondary">{t("financial.payroll.outstanding", "Outstanding")}</p>
            <p className="text-h4 font-bold text-text-primary tabular-nums">{formatCurrency(outstanding)}</p>
          </div>

          <div>
            <label htmlFor="payroll-amount" className="text-xs text-text-secondary block mb-1">
              {t("payments.amount", "Amount")}
            </label>
            <input
              id="payroll-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input w-full"
            />
          </div>

          <div>
            <label htmlFor="payroll-notes" className="text-xs text-text-secondary block mb-1">
              {t("payments.notes", "Notes")}
            </label>
            <textarea
              id="payroll-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input w-full resize-none"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-btn bg-danger-soft text-danger-strong px-3 py-2 text-xs">
              <AlertCircle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-border">
          <button type="button" onClick={onClose} className="btn btn-secondary text-xs">
            {t("common.cancel", "Cancel")}
          </button>
          <button type="button" onClick={submit} disabled={record.isPending} className="btn btn-primary text-xs">
            {record.isPending ? t("common.saving", "Saving…") : t("common.confirm", "Confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
