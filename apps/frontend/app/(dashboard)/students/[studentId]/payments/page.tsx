"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, User, CircleDollarSign, Printer, Plus, TrendingUp, Clock, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { studentsApi } from "@/lib/api/students.api";
import {
  useGenerateInvoiceForStudent,
  useRefreshPaymentStatuses,
  useStudentPaymentHistory,
} from "@/hooks/use-financial";
import { useFields, useLevels } from "@/hooks/use-queries";
import { openReceipt } from "@/lib/api/financial.api";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { PaymentActionsModal } from "@/components/financial/payment-actions-modal";
import { formatCurrency, formatDate, formatPeriod } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";
import type { StudentPayment } from "@/types";

export default function StudentPaymentsPage() {
  const { t } = useTranslation();
  const params = useParams();
  const router = useRouter();
  const studentId = params.studentId as string;
  const [selectedPayment, setSelectedPayment] = useState<StudentPayment | null>(null);
  const [months, setMonths] = useState("0");
  const [levelId, setLevelId] = useState("");
  const [fieldId, setFieldId] = useState("");
  const [groupId, setGroupId] = useState("");
  const hasAutoUpdated = useRef(false);

  const generatePayment = useGenerateInvoiceForStudent();
  const refreshStatuses = useRefreshPaymentStatuses();
  const { data: levels } = useLevels();
  const { data: fields } = useFields();

  const { data: student } = useQuery({
    queryKey: ["student", studentId],
    queryFn: () => studentsApi.get(studentId),
    enabled: !!studentId,
  });

  // Read through the financial module rather than the students endpoint: this
  // is the shape carrying `remaining_balance` and the ledger the actions modal
  // works from.
  const { data: payments, isLoading } = useStudentPaymentHistory(studentId);

  useEffect(() => {
    if (!payments || !studentId || hasAutoUpdated.current) return;
    hasAutoUpdated.current = true;
    refreshStatuses.mutate(studentId);
  }, [payments, studentId, refreshStatuses]);

  // The modal mutates through the financial cache, so the row it is showing has
  // to be re-read from the refreshed list or it keeps a stale balance.
  const monthlyFee = student?.monthly_fee ?? 0;

  /**
   * The entities this student actually belongs to, from their enrollment
   * chains. The filters below only offer these — one field enrolled, one field
   * in the list, and only its child groups selectable.
   */
  const scoped = useMemo(() => {
    const levels = new Set<string>();
    const fields = new Set<string>();
    const groups = new Set<string>();
    const chains = [student?.group, ...(student?.assignments ?? []).map((a) => a.group)];
    for (const chain of chains) {
      if (!chain) continue;
      groups.add(chain.id);
      const field = chain.professor?.field;
      if (field) {
        fields.add(field.id);
        if (field.level) levels.add(field.level.id);
      }
    }
    return { levels, fields, groups };
  }, [student]);

  /** The groups this student is actually billed for, scoped by the level/field filters. */
  const groupOptions = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; color: string | null }>();
    const add = (id: string, name: string, color: string | null) => {
      if (!id || seen.has(id)) return;
      seen.set(id, { id, name, color });
    };
    (student?.assignments ?? []).forEach((a) => {
      const g = a.group;
      if (!g) return;
      if (fieldId && g.professor?.field?.id !== fieldId) return;
      if (levelId && g.professor?.field?.level?.id !== levelId) return;
      add(g.id, g.name, g.color);
    });
    (payments ?? []).forEach((p) => {
      if (fieldId && p.context.field?.id !== fieldId) return;
      if (levelId && p.context.level?.id !== levelId) return;
      if (p.context.group) add(p.context.group.id, p.context.group.name, p.context.group.color);
    });
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [student, payments, fieldId]);

  const filteredPayments = useMemo(() => {
    if (!payments) return payments;
    return payments.filter(
      (p) =>
        (!levelId || p.context.level?.id === levelId) &&
        (!fieldId || p.context.field?.id === fieldId) &&
        (!groupId || p.context.group?.id === groupId),
    );
  }, [payments, levelId, fieldId, groupId]);

  const hasFilters = !!levelId || !!fieldId || !!groupId;

  // The modal mutates through the financial cache, so the row it is showing has
  // to be re-read from the refreshed list or it keeps a stale balance.
  const activePayment = selectedPayment
    ? (filteredPayments?.find((p) => p.id === selectedPayment.id) ?? selectedPayment)
    : null;

  const clearFilters = () => {
    setLevelId("");
    setFieldId("");
    setGroupId("");
  };

  const stats = useMemo(() => {
    if (!filteredPayments) return { totalDue: 0, totalPaid: 0, overdue: 0, dueSoon: 0, pending: 0, paid: 0 };
    let totalDue = 0, totalPaid = 0, overdue = 0, dueSoon = 0, pending = 0, paid = 0;
    filteredPayments.forEach((p) => {
      totalDue += Number(p.amount_due);
      if (p.paid_amount) totalPaid += Number(p.paid_amount);
      if (p.status === "overdue") overdue++;
      else if (p.status === "due_soon") dueSoon++;
      else if (p.status === "not_paid") pending++;
      else if (p.status === "paid") paid++;
    });
    return { totalDue, totalPaid, overdue, dueSoon, pending, paid };
  }, [filteredPayments]);

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
              {student.assignments && student.assignments.length > 0 && (
                <span className="flex items-center gap-1.5 flex-wrap">
                  <CircleDollarSign size={12} />
                  {student.assignments.map((a) => (
                    <span
                      key={a.id}
                      className="inline-flex items-center gap-1 rounded-btn border border-border bg-surface-2 px-2 py-0.5 text-xs"
                      title={a.group?.professor?.field?.name ?? a.group?.name}
                    >
                      <span className="font-medium text-text-primary">{a.group?.name}</span>
                      <span className="text-text-secondary">{formatCurrency(Number(a.fee))}/mo</span>
                    </span>
                  ))}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            {t("payments.monthsAhead", "Months")}
            <input
              type="number"
              min={0}
              max={12}
              value={months}
              onChange={(e) => setMonths(e.target.value)}
              className="input w-16 text-xs tabular-nums"
              title={t("payments.monthsAhead", "Months")}
            />
          </label>
          <button
            onClick={() => generatePayment.mutate({ studentId, months: parseInt(months, 10) || 0 })}
            disabled={generatePayment.isPending}
            className="btn btn-primary"
          >
            {generatePayment.isPending ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
            {t("payments.generateMonths", "Generate invoices")}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-neutral-soft rounded-card animate-pulse" />
          ))}
        </div>
      ) : payments && payments.length > 0 ? (
        <div className="card p-3 flex items-center gap-3 flex-wrap">
          <select
            aria-label={t("nav.levels", "Levels")}
            value={levelId}
            onChange={(e) => { setLevelId(e.target.value); setFieldId(""); setGroupId(""); }}
            className="input w-auto min-w-[140px] text-xs"
          >
            <option value="">{t("students.allLevels", "All levels")}</option>
            {levels
              ?.filter((level) => !scoped.levels.size || scoped.levels.has(level.id))
              .map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}
          </select>
          <select
            aria-label={t("nav.fields", "Fields")}
            value={fieldId}
            onChange={(e) => { setFieldId(e.target.value); setGroupId(""); }}
            className="input w-auto min-w-[140px] text-xs"
          >
            <option value="">{t("students.allFields", "All fields")}</option>
            {fields
              ?.filter((f) => (!levelId || f.level_id === levelId) && (!scoped.fields.size || scoped.fields.has(f.id)))
              .map((field) => (
                <option key={field.id} value={field.id}>{field.name}</option>
              ))}
          </select>
          <select
            aria-label={t("nav.groups", "Groups")}
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            disabled={groupOptions.length === 0}
            className="input w-auto min-w-[140px] text-xs disabled:opacity-50"
          >
            <option value="">{t("students.allGroups", "All groups")}</option>
            {groupOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="btn btn-secondary text-xs">
              {t("students.clearFilters", "Clear")}
            </button>
          )}
        </div>
      ) : null}

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 bg-neutral-soft rounded-card animate-pulse" />
          ))}
        </div>
      ) : filteredPayments && filteredPayments.length > 0 ? (
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
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("nav.levels", "Level")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("studentPayments.field", "Field")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("payments.group", "Group")}</th>
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
                <tr key={i} className="border-b border-border last:border-b-0">
                  {Array.from({ length: 10 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 w-full max-w-24 rounded bg-neutral-soft animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : filteredPayments?.length === 0 ? (
        <EmptyState message={t("studentPayments.noRecords")} />
      ) : (
        <div className="overflow-hidden rounded-table border border-border shadow-card">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-background">
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("studentPayments.period")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("nav.levels", "Level")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("studentPayments.field", "Field")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("payments.group", "Group")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("studentPayments.dueDate")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("studentPayments.amountDue")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("payments.paidAmount")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("studentPayments.status")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("studentPayments.method")}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase tracking-wider">{t("fieldsHierarchy.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredPayments?.map((p) => (
                <tr key={p.id} className="hover:bg-background/50 transition-colors">
                  <td className="px-4 py-3 font-medium">{formatPeriod(p.period)}</td>
                  <td className="px-4 py-3 text-text-secondary">{p.context.level?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-btn border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-primary" title={p.context.field?.name ?? ""}>
                      {p.context.field?.color && (
                        <span className="h-2.5 w-2.5 rounded-full inline-block shrink-0" style={{ backgroundColor: p.context.field.color }} />
                      )}
                      {p.context.field?.name ?? t("studentPayments.dash")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-btn border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-primary" title={p.context.group?.name ?? ""}>
                      {p.context.group?.color && (
                        <span className="h-2.5 w-2.5 rounded-full inline-block shrink-0" style={{ backgroundColor: p.context.group.color }} />
                      )}
                      {p.context.group?.name ?? t("studentPayments.dash")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{formatDate(p.due_date)}</td>
                  <td className="px-4 py-3">{formatCurrency(p.amount_due)}</td>
                  <td className="px-4 py-3">{p.paid_amount ? <span className="text-success-strong font-medium">{formatCurrency(p.paid_amount)}</span> : <span className="text-text-secondary">—</span>}</td>
                  <td className="px-4 py-3">
                    {/* Status is derived from the ledger now — it is reported,
                        not set. Changing it means recording money. */}
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 capitalize text-text-secondary">{p.payment_method ?? t("studentPayments.dash")}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {p.status === "paid" && student && (
                        <button
                          type="button"
                          onClick={() => openReceipt("payment", p.id).catch(() => {})}
                          aria-label={t("financial.printReceipt", "Print receipt")}
                          className="btn btn-secondary text-xs"
                        >
                          <Printer size={13} aria-hidden="true" />
                        </button>
                      )}
                      <button onClick={() => setSelectedPayment(p)} className="btn btn-secondary text-xs">
                        {t("financial.manage", "Manage")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activePayment && (
        <PaymentActionsModal
          payment={activePayment}
          isOpen={!!activePayment}
          onClose={() => setSelectedPayment(null)}
        />
      )}
    </div>
  );
}
