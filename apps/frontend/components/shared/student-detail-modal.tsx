"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, User, Phone, Mail, CalendarDays, DollarSign, UserCheck, Trash2 } from "lucide-react";
import { studentsApi } from "@/lib/api/students.api";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import { ErrorState, describeError } from "@/components/shared/error-state";
import { useToast } from "@/components/shared/toast";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import type { StudentStatus } from "@/types";
import { useTranslation } from "@/lib/i18n/context";
import Link from "next/link";

interface StudentDetailModalProps {
  studentId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function StudentDetailModal({ studentId, isOpen, onClose }: StudentDetailModalProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();

  // The field / professor / level / group lists used to be fetched here and
  // never read - four extra requests (including the full group list) on every
  // open. The assignment card reads the chain off the student record itself.
  const { data: student, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["student", studentId],
    queryFn: () => studentsApi.get(studentId),
    enabled: isOpen && !!studentId,
  });

  const [isEditing, setIsEditing] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    parent_phone: "",
    email: "",
    monthly_fee: "",
    status: "active" as StudentStatus,
    group_id: "",
  });

  useEffect(() => {
    if (student) {
      setForm({
        first_name: student.first_name,
        last_name: student.last_name,
        phone: student.phone,
        parent_phone: student.parent_phone ?? "",
        email: student.email ?? "",
        monthly_fee: String(student.monthly_fee),
        status: student.status,
        group_id: student.group_id,
      });
    }
  }, [student]);

  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false);
      setDeleteId(null);
      setDeleteError(null);
    }
  }, [isOpen]);

  /**
   * Confirming the delete used to just close the dialog, so "Delete student"
   * reported nothing and removed nothing - the student was still there after a
   * reload. It now calls the API and surfaces the server's refusal in place
   * (the backend declines to delete a student who has settled payments).
   */
  const deleteMutation = useMutation({
    mutationFn: (id: string) => studentsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["hierarchy-summary"] });
      toast.success(
        t("studentDetail.deleteStudent", "Student deleted"),
        student ? `${student.first_name} ${student.last_name}` : undefined,
      );
      setDeleteId(null);
      onClose();
    },
    onError: (err) => {
      const { detail } = describeError(err);
      setDeleteError(detail);
    },
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-card shadow-hover border border-border w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-h4 font-bold text-text-primary">
            {student ? `${student.first_name} ${student.last_name}` : t("studentDetail.loading")}
          </h2>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-btn hover:bg-background transition-colors" aria-label={t("common.close")}>
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 bg-neutral-soft rounded animate-pulse" />
              ))}
            </div>
          ) : isError ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : !student ? (
            <p className="text-text-secondary text-center py-8">{t("studentDetail.notFound")}</p>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="xl:col-span-2 space-y-6">
                  <div className="card">
                    <h3 className="text-h4 font-bold text-text-primary mb-4 flex items-center gap-2">
                      <User size={18} className="text-primary" />
                      {t("studentDetail.personalInfo")}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">{t("studentDetail.firstName")}</label>
                        {isEditing ? (
                          <input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} className="input w-full" />
                        ) : (
                          <p className="text-sm text-text-primary font-medium">{student.first_name}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">{t("studentDetail.lastName")}</label>
                        {isEditing ? (
                          <input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} className="input w-full" />
                        ) : (
                          <p className="text-sm text-text-primary font-medium">{student.last_name}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">{t("students.phone")}</label>
                        {isEditing ? (
                          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input w-full" />
                        ) : (
                          <p className="text-sm text-text-primary font-medium flex items-center gap-1.5">
                            <Phone size={13} className="text-text-secondary" /> {student.phone}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">{t("studentDetail.parentPhone")}</label>
                        {isEditing ? (
                          <input value={form.parent_phone} onChange={(e) => setForm({ ...form, parent_phone: e.target.value })} className="input w-full" />
                        ) : (
                          <p className="text-sm text-text-primary font-medium">{student.parent_phone ?? "—"}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">{t("studentDetail.email")}</label>
                        {isEditing ? (
                          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input w-full" />
                        ) : (
                          <p className="text-sm text-text-primary font-medium flex items-center gap-1.5">
                            <Mail size={13} className="text-text-secondary" /> {student.email ?? "—"}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">{t("studentDetail.monthlyFee")}</label>
                        {isEditing ? (
                          <input type="number" value={form.monthly_fee} onChange={(e) => setForm({ ...form, monthly_fee: e.target.value })} className="input w-full" />
                        ) : (
                          <p className="text-sm text-text-primary font-medium flex items-center gap-1.5">
                            <DollarSign size={13} className="text-text-secondary" /> {formatCurrency(student.monthly_fee)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="card">
                    <h3 className="text-h4 font-bold text-text-primary mb-4 flex items-center gap-2">
                      <CalendarDays size={18} className="text-primary" />
                      {t("studentDetail.enrollmentStatus")}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">{t("studentDetail.enrollmentDate")}</label>
                        <p className="text-sm text-text-primary font-medium">{formatDate(student.enrollment_date)}</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">{t("studentDetail.status")}</label>
                        {isEditing ? (
                          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as StudentStatus })} className="input w-full">
                            <option value="active">{t("students.active")}</option>
                            <option value="paused">{t("students.paused")}</option>
                            <option value="withdrawn">{t("students.withdrawn")}</option>
                          </select>
                        ) : (
                          <StatusBadge status={student.status} />
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="card">
                    <h3 className="text-h4 font-bold text-text-primary mb-4 flex items-center gap-2">
                      <UserCheck size={18} className="text-primary" />
                      {t("studentDetail.currentAssignment")}
                    </h3>
                    <div className="space-y-3 text-sm">
                      <div>
                        <p className="text-xs text-text-secondary">{t("studentDetail.field")}</p>
                        <p className="font-medium text-text-primary">{student.group?.level?.professor?.field?.name ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-text-secondary">{t("studentDetail.professor")}</p>
                        <p className="font-medium text-text-primary">{student.group?.level?.professor?.full_name ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-text-secondary">{t("studentDetail.level")}</p>
                        <p className="font-medium text-text-primary">{student.group?.level?.name ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-text-secondary">{t("studentDetail.group")}</p>
                        <p className="font-medium text-text-primary">{student.group?.name ?? "—"}</p>
                      </div>
                    </div>
                  </div>

                  <div className="card">
                    <h3 className="text-h4 font-bold text-text-primary mb-2">{t("studentDetail.quickActions")}</h3>
                    <div className="space-y-2">
                      <Link href={`/students/${studentId}/payments`} className="btn btn-primary text-xs w-full flex items-center justify-center gap-2">
                        <DollarSign size={14} /> {t("studentDetail.viewPayments")}
                      </Link>
                      <button onClick={() => setDeleteId(studentId)} className="btn btn-danger text-xs w-full flex items-center justify-center gap-2">
                        <Trash2 size={14} /> {t("studentDetail.deleteStudent")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDeleteDialog
        entityName={t("studentDetail.entityName")}
        isOpen={!!deleteId}
        error={deleteError ?? undefined}
        isDeleting={deleteMutation.isPending}
        onClose={() => { setDeleteId(null); setDeleteError(null); }}
        onConfirm={() => {
          if (deleteId && !deleteMutation.isPending) deleteMutation.mutate(deleteId);
        }}
      />
    </div>
  );
}
