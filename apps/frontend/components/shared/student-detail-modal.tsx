"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, DollarSign, Trash2, Pencil, ChevronRight, CalendarDays } from "lucide-react";
import { studentsApi } from "@/lib/api/students.api";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import { ErrorState, describeError } from "@/components/shared/error-state";
import { useToast } from "@/components/shared/toast";
import { PhoneInput } from "@/components/ui/phone-input";
import { formatCurrency, formatDate, studentTotalFee, cn } from "@/lib/utils/format";
import { normalizeTunisianPhone, stripTunisiaPrefix } from "@/lib/utils/phone";
import type { StudentStatus } from "@/types";
import { useTranslation } from "@/lib/i18n/context";
import Link from "next/link";
import AssignmentSlotsPicker, {
  emptyAssignmentSlot,
  type AssignmentSlot,
} from "@/components/hierarchy/assignment-slots-picker";
import { useMultiGroupCheck } from "@/hooks/use-scheduling";
import { StudentTimetableModal } from "@/components/scheduling/student-timetable-modal";

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
  const [assignmentSlots, setAssignmentSlots] = useState<AssignmentSlot[]>([emptyAssignmentSlot()]);
  const [timetableOpen, setTimetableOpen] = useState(false);
  const { data: eligibility } = useMultiGroupCheck(studentId);

  useEffect(() => {
    if (student) {
      setForm({
        first_name: student.first_name,
        last_name: student.last_name,
        phone: stripTunisiaPrefix(student.phone),
        parent_phone: stripTunisiaPrefix(student.parent_phone ?? ""),
        email: student.email ?? "",
        monthly_fee: String(student.monthly_fee),
        status: student.status,
        group_id: student.group_id,
      });
      // Seed one slot per enrollment (primary first); fall back to the legacy
      // single group relation for payloads that predate the join table.
      const enrollments = student.assignments?.length
        ? student.assignments
        : student.group
          ? [{ group_id: student.group_id, group: student.group }]
          : [];
      setAssignmentSlots(
        enrollments.length
          ? enrollments.map((a: any) => ({
              levelId: a.group?.professor?.field?.level?.id ?? "",
              fieldId: a.group?.professor?.field?.id ?? "",
              professorId: a.group?.professor?.id ?? "",
              groupId: a.group?.id ?? "",
              fee: a.fee !== undefined ? String(a.fee) : String(student.monthly_fee),
            }))
          : [emptyAssignmentSlot(String(student.monthly_fee))],
      );
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
    const complete = assignmentSlots.filter((s) => !!(s.levelId && s.fieldId && s.professorId && s.groupId));
    if (assignmentSlots.some((s) => !(s.levelId && s.fieldId && s.professorId && s.groupId))) {
      toast.error(
        t("students.assignmentInvalidTitle", "Incomplete assignment"),
        t("students.assignmentInvalid", "Finish each assignment: level, field, professor and group."),
      );
      return;
    }
    if (complete.some((s) => !(parseFloat(s.fee) > 0))) {
      toast.error(
        t("students.assignmentFeeInvalidTitle", "Missing fee"),
        t("students.assignmentFeeInvalid", "Every assignment needs a monthly fee."),
      );
      return;
    }
    updateMutation.mutate({
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      phone,
      parent_phone: parentPhone,
      email: form.email.trim() || null,
      enrollment_date: student?.enrollment_date,
      // The legacy single fee follows the primary enrollment for roll-ups;
      // billing itself reads the per-assignment fee.
      monthly_fee: parseFloat(complete[0].fee),
      status: form.status,
      assignments: complete.map((s) => ({ group_id: s.groupId, fee: parseFloat(s.fee) })),
    });
  };

  const isSaving = updateMutation.isPending;

  // One assignment row per enrollment, falling back to the legacy single group
  // relation for payloads that predate the join table.
  const assignments: Array<{ id?: string; group?: any; fee?: string | number | null }> = student?.assignments?.length
    ? student.assignments
    : student?.group
      ? [{ id: "primary", group: student.group }]
      : [];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-card shadow-hover border border-border w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-h4 font-bold text-text-primary flex items-center gap-3">
            {student ? `${student.first_name} ${student.last_name}` : t("studentDetail.loading")}
            {student && <StatusBadge status={student.status} />}
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
        <div className="flex-1 overflow-y-auto p-5">
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
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 items-start">
                {isEditing && (
                  <>
                    <div>
                      <p className="text-xs text-text-secondary mb-1">{t("studentDetail.firstName")}</p>
                      <input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} className="input w-full" />
                    </div>
                    <div>
                      <p className="text-xs text-text-secondary mb-1">{t("studentDetail.lastName")}</p>
                      <input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} className="input w-full" />
                    </div>
                  </>
                )}
                <div>
                  <p className="text-xs text-text-secondary mb-1">{t("students.phone")}</p>
                  {isEditing ? (
                    <PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
                  ) : (
                    <ValuePill className="font-mono tracking-wide">{student.phone}</ValuePill>
                  )}
                </div>
                <div>
                  <p className="text-xs text-text-secondary mb-1">{t("studentDetail.parentPhone")}</p>
                  {isEditing ? (
                    <PhoneInput value={form.parent_phone} onChange={(v) => setForm({ ...form, parent_phone: v })} />
                  ) : (
                    <ValuePill className="font-mono tracking-wide">{student.parent_phone ?? "—"}</ValuePill>
                  )}
                </div>
                <div>
                  <p className="text-xs text-text-secondary mb-1">{t("studentDetail.email")}</p>
                  {isEditing ? (
                    <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input w-full" />
                  ) : (
                    <ValuePill className="max-w-64 truncate">{student.email ?? "—"}</ValuePill>
                  )}
                </div>
                <div>
                  <p className="text-xs text-text-secondary mb-1">{t("studentDetail.enrollmentDate")}</p>
                  <ValuePill>{formatDate(student.enrollment_date)}</ValuePill>
                </div>
                <div>
                  <p className="text-xs text-text-secondary mb-1">{t("studentDetail.monthlyFee")}</p>
                  {isEditing ? (
                    <input type="number" value={form.monthly_fee} onChange={(e) => setForm({ ...form, monthly_fee: e.target.value })} className="input w-full" />
                  ) : (
                    <div>
                      <ValuePill tone="accent">{formatCurrency(studentTotalFee(student))}</ValuePill>
                      {assignments.length > 1 && (
                        <div className="mt-2 space-y-1.5 min-w-72">
                          {assignments.map((a) => (
                            <ValuePill key={a.id ?? "primary"} className="gap-1.5 flex-wrap w-fit">
                              <AssignmentPath
                                group={a.group}
                                fee={a.fee !== undefined ? formatCurrency(Number(a.fee)) : formatCurrency(Number(student.monthly_fee))}
                              />
                            </ValuePill>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs text-text-secondary mb-1">{t("studentDetail.status")}</p>
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

              {isEditing ? (
                <div className="border-t border-border pt-4">
                  <AssignmentSlotsPicker slots={assignmentSlots} onChange={setAssignmentSlots} />
                </div>
              ) : (
                <div className="border-t border-border pt-4">
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2.5">
                    {t("studentDetail.currentAssignment")}
                  </p>
                  <div className="space-y-2">
                    {assignments.map((a: any) => (
                      <div key={a.id ?? "primary"} className="flex items-center gap-2 text-xs text-text-secondary flex-wrap">
                        <AssignmentPath
                          group={a.group}
                          fee={a.fee !== undefined ? formatCurrency(Number(a.fee)) : formatCurrency(Number(student.monthly_fee))}
                        />
                      </div>
                    ))}
                  </div>
                  {eligibility?.eligible && (
                    <button
                      onClick={() => setTimetableOpen(true)}
                      className="btn btn-secondary text-xs mt-3 flex items-center gap-2"
                    >
                      <CalendarDays size={14} />
                      {t("scheduling.generateTimetable", "Générer l'emploi du temps")}
                    </button>
                  )}
                </div>
              )}

              <StudentTimetableModal
                studentId={studentId}
                studentName={`${student.first_name} ${student.last_name}`}
                open={timetableOpen}
                onClose={() => setTimetableOpen(false)}
              />

              {!isEditing && (
                <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
                  <Link href={`/students/${studentId}/payments`} className="btn btn-primary text-xs px-4 flex items-center justify-center gap-2">
                    <DollarSign size={14} /> {t("studentDetail.viewPayments")}
                  </Link>
                  <button onClick={() => setDeleteId(studentId)} className="btn btn-danger text-xs px-4 flex items-center justify-center gap-2">
                    <Trash2 size={14} /> {t("studentDetail.deleteStudent")}
                  </button>
                </div>
              )}
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

/**
 * Read-only value pill for the info grid — the same visual language as the
 * status badges, so the modal's facts read as labels instead of bare text.
 *
 * `tone="accent"` is reserved for the one figure worth standing out (frais).
 */
function ValuePill({
  children,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  tone?: "default" | "accent";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border/70 bg-background px-3 py-1.5 text-xs font-medium text-text-primary",
        tone === "accent" && "bg-gold-50 border-gold-200 text-gold-700",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The same compact hierarchy breadcrumb as the students table: level › field ›
 * professor › group, with the group name navigating to its hierarchy page.
 */
function AssignmentPath({ group, fee }: { group?: any; fee?: string }) {
  const levelName = group?.professor?.field?.level?.name;
  const fieldName = group?.professor?.field?.name;
  const professorName = group?.professor?.full_name;
  const groupName = group?.name;
  const groupId = group?.id;

  const crumbs: Array<{ key: string; node: React.ReactNode }> = [];
  if (levelName) crumbs.push({ key: "level", node: <span className="font-medium text-text-primary">{levelName}</span> });
  if (fieldName) crumbs.push({ key: "field", node: <span>{fieldName}</span> });
  if (professorName) crumbs.push({ key: "professor", node: <span>{professorName}</span> });
  if (groupName && groupId) {
    crumbs.push({
      key: "group",
      node: (
        <Link href={`/hierarchy/group/${groupId}`} className="font-medium text-primary hover:underline">
          {groupName}
        </Link>
      ),
    });
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs text-text-secondary flex-wrap">
      {crumbs.length === 0 ? (
        <span className="text-text-secondary">—</span>
      ) : (
        crumbs.map((crumb, i) => (
          <span key={crumb.key} className="inline-flex items-center gap-1">
            {i > 0 && <ChevronRight size={10} className="text-text-secondary/50 shrink-0" />}
            {crumb.node}
          </span>
        ))
      )}
      {fee && <span className="text-text-secondary/70">· {fee}</span>}
    </span>
  );
}
