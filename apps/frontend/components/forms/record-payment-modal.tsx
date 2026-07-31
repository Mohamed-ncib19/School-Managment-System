"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { ApiClient } from "@/lib/api/client";
import { FormButton } from "@/components/forms/form-helpers";
import { formatCurrency } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";
import type { StudentPayment, PaymentStatus } from "@/types";

interface RecordPaymentModalProps {
  payment: StudentPayment;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function RecordPaymentModal({ payment, isOpen, onClose, onSuccess }: RecordPaymentModalProps) {
  const { t } = useTranslation();
  const [paidAmount, setPaidAmount] = useState(payment.paid_amount?.toString() ?? payment.amount_due?.toString() ?? "");
  const [notes, setNotes] = useState(payment.notes ?? "");
  const queryClient = useQueryClient();

  const PAYMENT_STATUS_OPTIONS: { label: string; value: PaymentStatus }[] = [
    { label: t("payments.notPaid"), value: "not_paid" },
    { label: t("payments.dueSoon"), value: "due_soon" },
    { label: t("payments.overdue"), value: "overdue" },
    { label: t("payments.paid"), value: "paid" },
  ];

  const isUnpaid = payment.status !== "paid";
  const defaultStatus = isUnpaid ? "paid" : payment.status;
  const [status, setStatus] = useState<PaymentStatus>(defaultStatus);

  const [error, setError] = useState("");

  const settle = (mutation: { message?: string }) => ({
    onSuccess: () => {
      queryClient.invalidateQueries();
      onSuccess?.();
      onClose();
    },
    onError: (err: any) => {
      setError(err?.response?.data?.error?.message ?? mutation.message ?? t("payments.saveFailed", "Could not save the payment"));
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: (paymentId: string) =>
      ApiClient.post(`/payments/${paymentId}/record-payment`, {
        paid_amount: paidAmount,
        notes: notes.trim() || undefined,
      }),
    ...settle({}),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ paymentId, status }: { paymentId: string; status: PaymentStatus }) =>
      ApiClient.patch(`/payments/${paymentId}/status`, { status }),
    ...settle({}),
  });

  /**
   * One request per submit. Marking a payment paid used to PATCH the status and
   * then POST the amount as two separate calls, which double-logged the action
   * and left the row briefly marked paid with no record of who collected it.
   * Recording is now a single atomic call that carries the paid amount and notes.
   */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (status === "paid") {
      const amountChanged = paidAmount !== (payment.paid_amount?.toString() ?? payment.amount_due?.toString() ?? "");
      if (payment.status !== "paid" || amountChanged || notes.trim() !== (payment.notes ?? "")) {
        recordPaymentMutation.mutate(payment.id);
      } else {
        onClose();
      }
      return;
    }

    if (status !== payment.status) {
      updateStatusMutation.mutate({ paymentId: payment.id, status });
    } else {
      onClose();
    }
  };

  const isLoading = recordPaymentMutation.isPending || updateStatusMutation.isPending;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-h4 font-bold text-text-primary">{t("payments.recordPayment")}</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="mb-4 p-3 bg-background rounded-btn">
          <p className="text-sm text-text-secondary">{t("payments.studentName")}</p>
          <p className="font-medium text-text-primary">{payment.student?.first_name} {payment.student?.last_name}</p>
          <p className="text-sm text-text-secondary mt-1">{t("payments.period")}: {payment.period}</p>
          <p className="text-sm text-text-secondary">{t("payments.amountDue")}: {formatCurrency(payment.amount_due)}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div role="alert" className="p-3 rounded-btn bg-danger/10 text-danger text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">{t("payments.status")}</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as PaymentStatus)}
              className="input w-full"
            >
              {PAYMENT_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">{t("payments.paidAmount")}</label>
            <input
              type="text"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
              className="input w-full"
              placeholder={payment.amount_due?.toString() ?? ""}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">{t("payments.notes", "Notes (optional)")}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("payments.notesPlaceholder", "Add payment notes...")}
              rows={3}
              className="input w-full"
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t("fields.cancel")}
            </button>
            <FormButton type="submit" isLoading={isLoading}>
              {t("settings.saveChanges")}
            </FormButton>
          </div>
        </form>
      </div>
    </div>
  );
}
