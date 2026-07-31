"use client";

  import { useState, useMemo } from "react";
  import Link from "next/link";
  import { useParams, useRouter, useSearchParams } from "next/navigation";
  import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
  import { ArrowLeft, Plus, ChevronRight, Pencil, Trash2, Eye, DollarSign } from "lucide-react";
  import { studentsApi } from "@/lib/api/students.api";
  import { useFields, useProfessors, useLevels, useGroups } from "@/hooks/use-queries";
  import type { Student } from "@/types";
  import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
  import { EmptyState } from "@/components/shared/empty-state";
  import { StatusBadge } from "@/components/shared/status-badge";
  import { ViewToggle, type ViewMode } from "@/components/shared/view-toggle";
  import { TreeView, buildStudentTree } from "@/components/shared/tree-view";
  import StudentDetailModal from "@/components/shared/student-detail-modal";
  import { FormButton, ConfirmDeleteDialog } from "@/components/forms/form-helpers";
  import { formatDate, formatCurrency } from "@/lib/utils/format";
  import { useTranslation } from "@/lib/i18n/context";

export default function GroupStudentsPage() {
  const { t } = useTranslation();
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const fieldId = params.fieldId as string;
  const profId = params.profId as string;
  const levelId = params.levelId as string;
  const groupId = params.groupId as string;

  const { data: students, isLoading } = useQuery<Student[]>({
    queryKey: ["students", groupId],
    queryFn: () => studentsApi.list(groupId),
  });

  const { data: fields } = useFields();
  const { data: professors } = useProfessors(fieldId);
  const { data: levels } = useLevels(profId);
  const { data: groups } = useGroups(levelId);
  const field = fields?.find((f) => f.id === fieldId);
  const prof = professors?.find((p) => p.id === profId);
  const level = levels?.find((l) => l.id === levelId);
  const group = groups?.find((g) => g.id === groupId);

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [detailStudentId, setDetailStudentId] = useState<string | null>(null);

  // Create form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [email, setEmail] = useState("");
  const [enrollmentDate, setEnrollmentDate] = useState(new Date().toISOString().split("T")[0]);
  const [monthlyFee, setMonthlyFee] = useState("");

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setPhone("");
    setParentPhone("");
    setEmail("");
    setEnrollmentDate(new Date().toISOString().split("T")[0]);
    setMonthlyFee("");
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => studentsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["students", groupId] });
      setCreateOpen(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => studentsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["students", groupId] });
      setEditStudent(null);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => studentsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["students", groupId] });
      setDeleteId(null);
    },
  });

  const openEdit = (student: Student) => {
    setEditStudent(student);
    setFirstName(student.first_name);
    setLastName(student.last_name);
    setPhone(student.phone);
    setParentPhone(student.parent_phone ?? "");
    setEmail(student.email ?? "");
    setEnrollmentDate(student.enrollment_date.split("T")[0]);
    setMonthlyFee(String(student.monthly_fee));
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Link href="/fields" className="hover:text-primary">{t("fieldsHierarchy.breadcrumbFields")}</Link>
          <ChevronRight size={14} />
          <Link href={`/fields/${fieldId}/professors`} className="hover:text-primary">{field?.name ?? t("fieldsHierarchy.breadcrumbFields")}</Link>
          <ChevronRight size={14} />
          <Link href={`/fields/${fieldId}/professors/${profId}/levels`} className="hover:text-primary">{prof?.full_name ?? t("fieldsHierarchy.breadcrumbProfessors")}</Link>
          <ChevronRight size={14} />
          <Link href={`/fields/${fieldId}/professors/${profId}/levels/${levelId}/groups`} className="hover:text-primary">{level?.name ?? t("fieldsHierarchy.breadcrumbLevels")}</Link>
          <ChevronRight size={14} />
          <span className="text-text-primary font-medium">{group?.name ?? t("fieldsHierarchy.breadcrumbGroups")}</span>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="h-9 w-9 flex items-center justify-center rounded-btn hover:bg-neutral-soft" aria-label={t("fieldsHierarchy.goBack")}>
            <ArrowLeft size={18} />
          </button>
          <div>
             <h2 className="text-h4 font-bold text-text-primary">{group?.name ?? t("fieldsHierarchy.studentsTitle")}</h2>
             <p className="text-xs text-text-secondary">{t("fieldsHierarchy.studentsSubtitle")}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ViewToggle value={viewMode} onChange={setViewMode} />
          <button className="btn btn-primary" onClick={() => { resetForm(); setCreateOpen(true); }}>
            <Plus size={16} /> {t("fieldsHierarchy.addStudent")}
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <LoadingSkeleton key={i} type="table-row" />
            ))}
          </div>
        ) : !students?.length ? (
          <EmptyState message={t("fieldsHierarchy.noStudentsYet")} actionLabel={t("fieldsHierarchy.addStudent")} onAction={() => { resetForm(); setCreateOpen(true); }} />
        ) : viewMode === "list" ? (
          <div className="overflow-hidden rounded-table border border-border shadow-card">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("students.name")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("students.phone")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("students.group")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("students.fee")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("students.status")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase">{t("students.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {students?.map((student) => (
                  <tr key={student.id} className="hover:bg-background/50 transition-colors">
                    <td className="px-4 py-3">
                      <button onClick={() => setDetailStudentId(student.id)} className="text-primary hover:underline font-medium">
                        {student.first_name} {student.last_name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{student.phone}</td>
                    <td className="px-4 py-3 text-text-secondary">{student.group?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-text-secondary">{formatCurrency(student.monthly_fee)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={student.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openEdit(student)}
                          className="text-text-secondary hover:text-primary transition-colors"
                          aria-label={`${t("fieldsHierarchy.editStudentTitle")} ${student.first_name}`}
                        >
                          <Pencil size={14} />
                        </button>
                        <Link
                          href={`/students/${student.id}/payments`}
                          className="text-text-secondary hover:text-primary transition-colors"
                          aria-label={`${t("students.payments")} ${student.first_name}`}
                        >
                          <DollarSign size={14} />
                        </Link>
                        <button
                          onClick={() => setDeleteId(student.id)}
                          className="text-text-secondary hover:text-danger transition-colors"
                          aria-label={`${t("common.delete")} ${student.first_name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : viewMode === "cards" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {students?.map((student) => (
              <div key={student.id} className="card hover:shadow-hover transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary-50 flex items-center justify-center text-xs font-bold text-primary">
                      {`${student.first_name[0]}${student.last_name[0]}`}
                    </div>
                    <div>
                      <button onClick={() => setDetailStudentId(student.id)} className="font-semibold text-text-primary text-left hover:underline">
                        {student.first_name} {student.last_name}
                      </button>
                      <p className="text-xs text-text-secondary">{student.phone}</p>
                    </div>
                  </div>
                  <StatusBadge status={student.status} />
                </div>
                <div className="mt-3 space-y-1 text-sm">
                  <p className="text-text-secondary"><span className="font-medium">{t("students.groupLabel")}</span> {student.group?.name ?? "—"}</p>
                  <p className="text-text-secondary"><span className="font-medium">{t("students.feeLabel")}</span> {formatCurrency(student.monthly_fee)}</p>
                </div>
                <div className="mt-4 flex gap-2">
                  <button onClick={() => setDetailStudentId(student.id)} className="btn btn-secondary text-xs flex-1">{t("students.viewDetails")}</button>
                  <Link href={`/students/${student.id}/payments`} className="btn btn-primary text-xs flex-1">{t("students.payments")}</Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <TreeView
            data={buildStudentTree(students ?? [])}
            onSelect={(node) => {
              if (node.type === "field") router.push(`/fields/${node.id}/professors`);
              if (node.type === "professor") router.push(`/professors`);
              if (node.type === "level") router.push(`/levels`);
              if (node.type === "group") router.push(`/groups`);
            }}
            onStudentSelect={(student) => setDetailStudentId(student.id)}
          />
        )}

        {detailStudentId && (
          <StudentDetailModal
            studentId={detailStudentId}
            isOpen={!!detailStudentId}
            onClose={() => setDetailStudentId(null)}
          />
        )}
      </div>

      {/* Create Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCreateOpen(false)}>
          <div className="bg-surface rounded-modal shadow-hover p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-h4 font-bold mb-4">{t("fieldsHierarchy.addStudent")}</h3>
            <form onSubmit={(e) => { e.preventDefault(); if (firstName.trim() && lastName.trim() && phone.trim()) createMutation.mutate({ group_id: groupId, first_name: firstName.trim(), last_name: lastName.trim(), phone: phone.trim(), parent_phone: parentPhone.trim() || undefined, email: email.trim() || undefined, enrollment_date: enrollmentDate, monthly_fee: parseFloat(monthlyFee) || 0 }); }} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("students.firstName")}</label>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="input" autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("students.lastName")}</label>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("students.phone")}</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.parentPhoneOptional")}</label>
                <input value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.emailOptional2")}</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("students.enrollmentDate")}</label>
                <input type="date" value={enrollmentDate} onChange={(e) => setEnrollmentDate(e.target.value)} className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("students.monthlyFee")}</label>
                <input type="number" value={monthlyFee} onChange={(e) => setMonthlyFee(e.target.value)} className="input" />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>{t("fieldsHierarchy.cancel")}</button>
                <FormButton type="submit" isLoading={createMutation.isPending}>{t("fieldsHierarchy.create")}</FormButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditStudent(null)}>
          <div className="bg-surface rounded-modal shadow-hover p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-h4 font-bold mb-4">{t("fieldsHierarchy.editStudentTitle")}</h3>
            <form onSubmit={(e) => { e.preventDefault(); if (firstName.trim() && lastName.trim() && phone.trim()) updateMutation.mutate({ id: editStudent.id, data: { first_name: firstName.trim(), last_name: lastName.trim(), phone: phone.trim(), parent_phone: parentPhone.trim() || undefined, email: email.trim() || undefined, enrollment_date: enrollmentDate, monthly_fee: parseFloat(monthlyFee) || 0 } }); }} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("students.firstName")}</label>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="input" autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("students.lastName")}</label>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("students.phone")}</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.parentPhoneOptional")}</label>
                <input value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.emailOptional2")}</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("students.enrollmentDate")}</label>
                <input type="date" value={enrollmentDate} onChange={(e) => setEnrollmentDate(e.target.value)} className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("students.monthlyFee")}</label>
                <input type="number" value={monthlyFee} onChange={(e) => setMonthlyFee(e.target.value)} className="input" />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" className="btn btn-secondary" onClick={() => setEditStudent(null)}>{t("students.cancel")}</button>
                <FormButton type="submit" isLoading={updateMutation.isPending}>{t("students.saveChanges")}</FormButton>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        entityName={t("studentDetail.entityName")}
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
      />
    </>
  );
}
