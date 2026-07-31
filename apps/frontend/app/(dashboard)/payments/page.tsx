"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Plus, RefreshCw, Search, CircleDollarSign, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { usePayments, useGenerateMonthlyPayments } from "@/hooks/use-payments";
import { useFields, useProfessors, useLevels, useGroups, useStudents } from "@/hooks/use-queries";
import type { StudentPayment } from "@/types";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { PaymentStatusControl } from "@/components/shared/payment-status-control";
import { RecordPaymentModal } from "@/components/forms/record-payment-modal";
import { ViewToggle, type ViewMode } from "@/components/shared/view-toggle";
import { PaymentReceipt } from "@/components/shared/payment-receipt";
import { cn, formatCurrency, formatDate, formatPeriod } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";

const STATUS_FILTER_OPTIONS: { label: string; value: string; icon: any }[] = [
  { label: "payments.all", value: "all", icon: null },
  { label: "payments.notPaid", value: "not_paid", icon: Clock },
  { label: "payments.dueSoon", value: "due_soon", icon: AlertTriangle },
  { label: "payments.overdue", value: "overdue", icon: AlertTriangle },
  { label: "payments.paid", value: "paid", icon: CheckCircle2 },
];

export default function PaymentsPage() {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState("all");
  const [fieldId, setFieldId] = useState("");
  const [profId, setProfId] = useState("");
  const [levelId, setLevelId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedPayment, setSelectedPayment] = useState<StudentPayment | null>(null);
  const generatePayments = useGenerateMonthlyPayments();

  const effectiveStatus = statusFilter === "all" ? undefined : statusFilter;
  const { data: payments, isLoading } = usePayments({
    status: effectiveStatus,
    fieldId: fieldId || undefined,
    profId: profId || undefined,
    levelId: levelId || undefined,
    groupId: groupId || undefined,
  });

  const { data: fields } = useFields();
  const { data: professors } = useProfessors(fieldId || undefined);
  const { data: levels } = useLevels(profId || undefined);
  const { data: groups } = useGroups(levelId || undefined);

  const { data: allStudents } = useStudents();

  const studentMap = useMemo(() => {
    const map: Record<string, any> = {};
    allStudents?.forEach((s: any) => { map[s.id] = s; });
    return map;
  }, [allStudents]);

  const filteredPayments = useMemo(() => {
    if (!payments) return [];
    if (!search) return payments;
    const q = search.toLowerCase();
    return payments.filter((p) => {
      const s = studentMap[p.student_id];
      const name = s ? `${s.first_name} ${s.last_name}`.toLowerCase() : "";
      return name.includes(q) || p.period.toLowerCase().includes(q);
    });
  }, [payments, search, studentMap]);

  const stats = useMemo(() => {
    if (!payments) return { totalDue: 0, totalPaid: 0, overdue: 0, dueSoon: 0, count: 0 };
    let totalDue = 0, totalPaid = 0, overdue = 0, dueSoon = 0;
    payments.forEach((p) => {
      totalDue += Number(p.amount_due);
      if (p.paid_amount) totalPaid += Number(p.paid_amount);
      if (p.status === "overdue") overdue++;
      if (p.status === "due_soon") dueSoon++;
    });
    return { totalDue, totalPaid, overdue, dueSoon, count: payments.length };
  }, [payments]);

  const clearFilters = () => {
    setFieldId(""); setProfId(""); setLevelId(""); setGroupId(""); setStatusFilter("all"); setSearch("");
  };
  const hasFilters = fieldId || profId || levelId || groupId || statusFilter !== "all" || search;

  const getStudent = (studentId: string) => studentMap[studentId];
  const getStudentName = (studentId: string) => {
    const s = studentMap[studentId];
    return s ? `${s.first_name} ${s.last_name}` : "";
  };
  const getGroupName = (studentId: string) => {
    const s = studentMap[studentId];
    return s?.group?.name ?? "—";
  };
  const getFieldName = (studentId: string) => {
    const s = studentMap[studentId];
    return s?.group?.level?.professor?.field?.name ?? "—";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Link href="/dashboard" className="hover:text-primary">{t("payments.dashboardBreadcrumb")}</Link>
        <ChevronRight size={14} />
        <span className="text-text-primary font-medium">{t("payments.title")}</span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-h4 font-bold text-text-primary">{t("payments.title")}</h2>
          <p className="text-xs text-text-secondary">{t("payments.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={viewMode} onChange={setViewMode} />
          <button onClick={() => generatePayments.mutate()} disabled={generatePayments.isPending} className="btn btn-primary">
            {generatePayments.isPending ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
            {t("payments.generateMonthly")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card flex items-center gap-3">
          <div className="h-10 w-10 rounded-btn bg-primary-50 flex items-center justify-center text-primary"><CircleDollarSign size={18} /></div>
          <div><p className="text-xs text-text-secondary">{t("payments.totalDue", "Total Due")}</p><p className="text-h4 font-bold text-text-primary">{formatCurrency(stats.totalDue)}</p></div>
        </div>
        <div className="card flex items-center gap-3">
          <div className="h-10 w-10 rounded-btn bg-success-soft flex items-center justify-center text-success-strong"><CheckCircle2 size={18} /></div>
          <div><p className="text-xs text-text-secondary">{t("payments.totalPaid", "Total Paid")}</p><p className="text-h4 font-bold text-success-strong">{formatCurrency(stats.totalPaid)}</p></div>
        </div>
        <div className="card flex items-center gap-3">
          <div className="h-10 w-10 rounded-btn bg-danger-soft flex items-center justify-center text-danger-strong"><AlertTriangle size={18} /></div>
          <div><p className="text-xs text-text-secondary">{t("payments.overdue")}</p><p className="text-h4 font-bold text-danger-strong">{stats.overdue}</p></div>
        </div>
        <div className="card flex items-center gap-3">
          <div className="h-10 w-10 rounded-btn bg-gold-50 flex items-center justify-center text-gold-700"><Clock size={18} /></div>
          <div><p className="text-xs text-text-secondary">{t("payments.dueSoon")}</p><p className="text-h4 font-bold text-gold-700">{stats.dueSoon}</p></div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input type="text" placeholder={t("students.searchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-9 w-full" />
          </div>
          <select value={fieldId} onChange={(e) => { setFieldId(e.target.value); setProfId(""); setLevelId(""); setGroupId(""); }} className="input w-auto min-w-[140px]">
            <option value="">{t("students.allFields")}</option>
            {fields?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select value={profId} onChange={(e) => { setProfId(e.target.value); setLevelId(""); setGroupId(""); }} disabled={!fieldId} className="input w-auto min-w-[140px] disabled:opacity-50">
            <option value="">{t("students.allProfessors")}</option>
            {professors?.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <select value={levelId} onChange={(e) => { setLevelId(e.target.value); setGroupId(""); }} disabled={!profId} className="input w-auto min-w-[140px] disabled:opacity-50">
            <option value="">{t("students.allLevels")}</option>
            {levels?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={!levelId} className="input w-auto min-w-[140px] disabled:opacity-50">
            <option value="">{t("students.allGroups")}</option>
            {groups?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn btn-secondary text-xs">{t("students.clearFilters")}</button>}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTER_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <button key={option.value} onClick={() => setStatusFilter(option.value)} className={cn("btn text-xs", statusFilter === option.value ? "btn-primary" : "btn-secondary")}>
              {Icon && <Icon size={14} />}
              {t(option.label)}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <LoadingSkeleton key={i} type="table-row" />)}</div>
      ) : filteredPayments.length === 0 ? (
        <EmptyState message={t("payments.noPaymentsYet")} />
      ) : viewMode === "cards" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPayments.map((p) => {
            const student = getStudent(p.student_id);
            return (
              <div key={p.id} className="card hover:shadow-hover transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary-50 flex items-center justify-center text-xs font-bold text-primary">
                      {student ? `${student.first_name[0]}${student.last_name[0]}` : "?"}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-text-primary">{getStudentName(p.student_id) || "—"}</p>
                      <p className="text-xs text-text-secondary">{getGroupName(p.student_id)}</p>
                    </div>
                  </div>
                  <PaymentStatusControl
                    paymentId={p.id}
                    status={p.status}
                    onRecordPayment={() => setSelectedPayment(p)}
                  />
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-text-secondary">{t("payments.period")}</span><span className="font-medium">{formatPeriod(p.period)}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">{t("payments.dueDate")}</span><span className="font-medium">{formatDate(p.due_date)}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">{t("payments.amountDue")}</span><span className="font-medium">{formatCurrency(p.amount_due)}</span></div>
                  {p.paid_amount && <div className="flex justify-between"><span className="text-text-secondary">{t("payments.paidAmount")}</span><span className="font-medium text-success-strong">{formatCurrency(p.paid_amount)}</span></div>}
                </div>
                <div className="mt-4 pt-3 border-t border-border flex items-center gap-2">
                  <button onClick={() => setSelectedPayment(p)} className="btn btn-primary text-xs flex-1">
                    {p.status === "paid" ? t("payments.viewDetails", "Details") : t("payments.recordPayment")}
                  </button>
                  {p.status === "paid" && (
                    <PaymentReceipt payment={p} studentName={getStudentName(p.student_id)} groupName={getGroupName(p.student_id)} fieldName={getFieldName(p.student_id)} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-table border border-border shadow-card">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("payments.studentName")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("students.group")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("payments.period")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("payments.dueDate")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("payments.status")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase">{t("payments.amountDue")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase">{t("payments.paidAmount")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase">{t("payments.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredPayments.map((p) => (
                  <tr key={p.id} className="hover:bg-background/50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/students/${p.student_id}/payments`} className="text-primary hover:underline font-medium">
                        {getStudentName(p.student_id) || "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{getGroupName(p.student_id)}</td>
                    <td className="px-4 py-3 text-text-secondary">{formatPeriod(p.period)}</td>
                    <td className="px-4 py-3 text-text-secondary">{formatDate(p.due_date)}</td>
                    <td className="px-4 py-3">
                      <PaymentStatusControl
                        paymentId={p.id}
                        status={p.status}
                        onRecordPayment={() => setSelectedPayment(p)}
                      />
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(p.amount_due)}</td>
                    <td className="px-4 py-3 text-right">{p.paid_amount ? <span className="text-success-strong font-medium">{formatCurrency(p.paid_amount)}</span> : <span className="text-text-secondary">—</span>}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {p.status === "paid" && <PaymentReceipt payment={p} studentName={getStudentName(p.student_id)} groupName={getGroupName(p.student_id)} fieldName={getFieldName(p.student_id)} />}
                        <button onClick={() => setSelectedPayment(p)} className="btn btn-secondary text-xs">{t("payments.recordPayment")}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedPayment && <RecordPaymentModal payment={selectedPayment} isOpen={!!selectedPayment} onClose={() => setSelectedPayment(null)} />}
    </div>
  );
}
