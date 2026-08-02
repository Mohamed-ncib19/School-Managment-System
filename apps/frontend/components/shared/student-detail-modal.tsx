"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, User, Phone, Mail, CalendarDays, DollarSign, UserCheck, Trash2, Pencil } from "lucide-react";
import { studentsApi } from "@/lib/api/students.api";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import { ErrorState, describeError } from "@/components/shared/error-state";
import { useToast } from "@/components/shared/toast";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { normalizeTunisianPhone, TUNISIA_PHONE_PLACEHOLDER } from "@/lib/utils/phone";
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

  /**
   * The edit mode used to have no entry point: the fields rendered as inputs
   * once `isEditing` was true, but nothing ever set it, so names, fee and —
   * the important one — the enrollment status could never be changed.
   */
  const updateMutation = useMutation({
    mutationFn: (data: any) => studentsApi.update(studentId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["student", studentId] });
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["hierarchy-summary"] });
      setIsEditing(false);
      toast.success(
        t("studentDetail.saveChanges", "Changes saved"),
        t("common.saved", "Saved"),
      );
    },
    onError: (err) => {
      const { detail } = describeError(err);
      toast.error(t("studentDetail.saveFailed", "Could not save"), detail);
    },
  });

  const handleSave = () => {
    if (!form.first_name.trim() || !form.last_name.trim() || !form.phone.trim()) {
      toast.error(t("students.fillRequired", "Please fill in all required fields"));
      return;
    }
    const phone = normalizeTunisianPhone(form.phone);
    if (!phone) {
      toast.error(t("students.phoneInvalidTitle", "Invalid phone number"), t("students.phoneInvalid", "Phone must be 8 digits, e.g. +216 22 123 456"));
      return;
    }
    const parentPhone = form.parent_phone.trim() ? normalizeTunisianPhone(form.parent_phone) : null;
    if (form.parent_phone.trim() && !parentPhone) {
      toast.error(t("students.phoneInvalidTitle", "Invalid phone number"), t("students.parentPhoneInvalid", "Parent phone must be 8 digits, e.g. +216 22 123 456"));
      return;
    }
    updateMutation.mutate({
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      phone,
      parent_phone: parentPhone,
      email: form.email.trim() || null,
      monthly_fee: parseFloat(form.monthly_fee) || 0,
      status: form.status,
    });
  };

  const isSaving = updateMutation.isPending;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-card shadow-hover border border-border w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-h4 font-bold text-text-primary">
            {student ? `${student.first_name} ${student.last_name}` : t("studentDetail.loading")}
          </h2>
          <div className="flex items-center gap-2">
            {student && isEditing ? (
              <>
                <button
                  onClick={() => { if (!isSaving) { setIsEditing(false); } }}
                  disabled={isSaving}
                  className="btn btn-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t("studentDetail.cancel", "Cancel")}
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="btn btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? t("common.saving", "Saving…") : t("studentDetail.saveChanges", "Save Changes")}
                </button>
              </>
            ) : (
              student && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="btn btn-secondary px-3 py-1.5 text-xs"
                >
                  <Pencil size={13} className="inline-block" /> {t("common.edit", "Edit")}
                </button>
              )
            )}
            <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-btn hover:bg-background transition-colors" aria-label={t("common.close")}>
              <X size={18} />
            </button>
          </div>
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
                          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input w-full" placeholder={TUNISIA_PHONE_PLACEHOLDER} inputMode="tel" />
                        ) : (
                          <p className="text-sm text-text-primary font-medium flex items-center gap-1.5">
                            <Phone size={13} className="text-text-secondary" /> {student.phone}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">{t("studentDetail.parentPhone")}</label>
                        {isEditing ? (
                          <input value={form.parent_phone} onChange={(e) => setForm({ ...form, parent_phone: e.target.value })} className="input w-full" placeholder={TUNISIA_PHONE_PLACEHOLDER} inputMode="tel" />
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
                    <div className="space-y-4 text-sm">
                      {(student.assignments?.length
                        ? student.assignments
                        : student.group
                          ? [{ id: "primary", group: student.group }]
                          : []
                      ).map((a: any, i: number) => {
                        const field = a.group?.professor?.field;
                        const level = field?.level;
                        const rows = [
                          { label: t("studentDetail.level"), value: level?.name },
                          { label: t("studentDetail.field"), value: field?.name },
                          { label: t("studentDetail.professor"), value: a.group?.professor?.full_name },
                          { label: t("studentDetail.group"), value: a.group?.name },
                          {
                            label: t("studentDetail.monthlyFee"),
                            value: a.fee !== undefined
                              ? formatCurrency(Number(a.fee))
                              : formatCurrency(Number(student.monthly_fee)),
                          },
                        ];
                        return (
                          <div key={a.id ?? "primary"} className={i > 0 ? "pt-3 border-t border-border" : ""}>
                            {i > 0 && (
                              <p className="text-xs font-semibold text-text-secondary mb-2">
                                {t("students.assignmentExtra", "Additional")} #{i + 1}
                              </p>
                            )}
                            <div className="space-y-3">
                              {rows.map((row) => (
                                <div key={row.label}>
                                  <p className="text-xs text-text-secondary">{row.label}</p>
                                  <p className="font-medium text-text-primary">{row.value ?? "—"}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
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
