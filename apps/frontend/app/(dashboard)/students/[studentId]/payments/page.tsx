"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, User, CircleDollarSign, Printer, Plus, TrendingUp, Clock, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { studentsApi } from "@/lib/api/students.api";
import { useGeneratePaymentForStudent, useUpdatePaymentStatusesForStudent } from "@/hooks/use-payments";
import { PaymentReceipt } from "@/components/shared/payment-receipt";
import { PaymentStatusControl } from "@/components/shared/payment-status-control";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { RecordPaymentModal } from "@/components/forms/record-payment-modal";
import { formatCurrency, formatDate, formatPeriod } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";
import type { StudentPayment } from "@/types";

export default function StudentPaymentsPage() {
  const { t } = useTranslation();
  const params = useParams();
  const router = useRouter();
  const studentId = params.studentId as string;
  const queryClient = useQueryClient();
  const [selectedPayment, setSelectedPayment] = useState<StudentPayment | null>(null);
  const hasAutoUpdated = useRef(false);

  const generatePayment = useGeneratePaymentForStudent();
  const updateStatuses = useUpdatePaymentStatusesForStudent();

  const { data: student } = useQuery({
    queryKey: ["student", studentId],
    queryFn: () => studentsApi.get(studentId),
    enabled: !!studentId,
  });

  const { data: payments, isLoading } = useQuery({
    queryKey: ["studentPayments", studentId],
    queryFn: () => studentsApi.getPayments(studentId),
    enabled: !!studentId,
  });

  useEffect(() => {
    if (!payments || !studentId || hasAutoUpdated.current) return;
    hasAutoUpdated.current = true;
    updateStatuses.mutate(studentId);
  }, [payments, studentId, updateStatuses]);

  const monthlyFee = student?.monthly_fee ?? 0;

  const stats = useMemo(() => {
    if (!payments) return { totalDue: 0, totalPaid: 0, overdue: 0, dueSoon: 0, pending: 0, paid: 0 };
    let totalDue = 0, totalPaid = 0, overdue = 0, dueSoon = 0, pending = 0, paid = 0;
    payments.forEach((p) => {
      totalDue += Number(p.amount_due);
      if (p.paid_amount) totalPaid += Number(p.paid_amount);
      if (p.status === "overdue") overdue++;
      else if (p.status === "due_soon") dueSoon++;
      else if (p.status === "not_paid") pending++;
      else if (p.status === "paid") paid++;
    });
    return { totalDue, totalPaid, overdue, dueSoon, pending, paid };
  }, [payments]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="h-9 w-9 flex items-center justify-center rounded-btn hover:bg-neutral-soft" aria-label={t("studentPayments.goBack")}>
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h2 className="text-h4 font-bold text-text-primary">
            {student ? `${student.first_name} ${student.last_name}` : t("studentPayments.title")}
          </h2>
          {student && (
            <div className="flex items-center gap-4 text-xs text-text-secondary mt-0.5">
              <span className="flex items-center gap-1"><User size={12} /> {student.phone}</span>
              <span>{student.email ?? t("studentPayments.dash")}</span>
              <span className="flex items-center gap-1"><CircleDollarSign size={12} /> {t("studentDetail.monthlyFee")}: {formatCurrency(monthlyFee)}</span>
            </div>
          )}
        </div>
        <button
          onClick={() => generatePayment.mutate(studentId)}
          disabled={generatePayment.isPending}
          className="btn btn-primary"
        >
          {generatePayment.isPending ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
          {t("payments.generateMonthly", "Generate Monthly Payment")}
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-neutral-soft rounded-card animate-pulse" />
          ))}
        </div>
      ) : payments && payments.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="card flex items-center gap-3">
            <div className="h-10 w-10 rounded-btn bg-primary-50 flex items-center justify-center text-primary shrink-0"><CircleDollarSign size={18} /></div>
            <div><p className="text-[10px] uppercase tracking-wider text-text-secondary">{t("payments.totalDue", "Total Due")}</p><p className="text-sm font-bold text-text-primary">{formatCurrency(stats.totalDue)}</p></div>
          </div>
          <div className="card flex items-center gap-3">
            <div className="h-10 w-10 rounded-btn bg-success-soft flex items-center justify-center text-success-strong shrink-0"><CheckCircle2 size={18} /></div>
            <div><p className="text-[10px] uppercase tracking-wider text-text-secondary">{t("payments.totalPaid", "Total Paid")}</p><p className="text-sm font-bold text-success-strong">{formatCurrency(stats.totalPaid)}</p></div>
          </div>
          <div className="card flex items-center gap-3">
            <div className="h-10 w-10 rounded-btn bg-gold-50 flex items-center justify-center text-gold-700 shrink-0"><Clock size={18} /></div>
            <div><p className="text-[10px] uppercase tracking-wider text-text-secondary">{t("payments.dueSoon")}</p><p className="text-sm font-bold text-gold-700">{stats.dueSoon}</p></div>
          </div>
          <div className="card flex items-center gap-3">
            <div className="h-10 w-10 rounded-btn bg-danger-soft flex items-center justify-center text-danger-strong shrink-0"><AlertTriangle size={18} /></div>
            <div><p className="text-[10px] uppercase tracking-wider text-text-secondary">{t("payments.overdue")}</p><p className="text-sm font-bold text-danger-strong">{stats.overdue}</p></div>
          </div>
          <div className="card flex items-center gap-3">
            <div className="h-10 w-10 rounded-btn bg-neutral-soft flex items-center justify-center text-neutral-strong shrink-0"><Clock size={18} /></div>
            <div><p className="text-[10px] uppercase tracking-wider text-text-secondary">{t("payments.pending", "Pending")}</p><p className="text-sm font-bold text-text-primary">{stats.pending}</p></div>
          </div>
          <div className="card flex items-center gap-3">
            <div className="h-10 w-10 rounded-btn bg-success-soft flex items-center justify-center text-success-strong shrink-0"><TrendingUp size={18} /></div>
            <div><p className="text-[10px] uppercase tracking-wider text-text-secondary">{t("payments.paid", "Paid")}</p><p className="text-sm font-bold text-success-strong">{stats.paid}</p></div>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="overflow-hidden rounded-table border border-border">
          <table className="min-w-full">
            <thead>
              <tr className="bg-background">
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("studentPayments.period")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("studentPayments.dueDate")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("studentPayments.amountDue")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("payments.paidAmount")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("studentPayments.status")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("studentPayments.method")}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 4 }).map((_, i) => (
                <LoadingSkeleton key={i} type="table-row" />
              ))}
            </tbody>
          </table>
        </div>
      ) : payments?.length === 0 ? (
        <EmptyState message={t("studentPayments.noRecords")} />
      ) : (
        <div className="overflow-hidden rounded-table border border-border shadow-card">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-background">
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("studentPayments.period")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("studentPayments.dueDate")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("studentPayments.amountDue")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("payments.paidAmount")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("studentPayments.status")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("studentPayments.method")}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("fieldsHierarchy.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {payments?.map((p) => (
                <tr key={p.id} className="hover:bg-background/50 transition-colors">
                  <td className="px-4 py-3 font-medium">{formatPeriod(p.period)}</td>
                  <td className="px-4 py-3 text-text-secondary">{formatDate(p.due_date)}</td>
                  <td className="px-4 py-3">{formatCurrency(p.amount_due)}</td>
                  <td className="px-4 py-3">{p.paid_amount ? <span className="text-success-strong font-medium">{formatCurrency(p.paid_amount)}</span> : <span className="text-text-secondary">—</span>}</td>
                  <td className="px-4 py-3">
                    <PaymentStatusControl
                      paymentId={p.id}
                      status={p.status}
                      onRecordPayment={() => setSelectedPayment(p)}
                    />
                  </td>
                  <td className="px-4 py-3 capitalize text-text-secondary">{p.payment_method ?? t("studentPayments.dash")}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {p.status === "paid" && student && (
                        <PaymentReceipt payment={p} studentName={`${student.first_name} ${student.last_name}`} groupName={student.group?.name ?? "—"} fieldName={student.group?.level?.professor?.field?.name ?? "—"} />
                      )}
                      <button onClick={() => setSelectedPayment(p)} className="btn btn-secondary text-xs">
                        {p.status === "paid" ? t("payments.viewDetails", "Details") : t("payments.recordPayment")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedPayment && (
        <RecordPaymentModal
          payment={selectedPayment}
          isOpen={!!selectedPayment}
          onClose={() => setSelectedPayment(null)}
          onSuccess={() => queryClient.invalidateQueries()}
        />
      )}
    </div>
  );
}
