"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, ChevronRight, Trash2, DollarSign, Eye, Plus } from "lucide-react";
import { studentsApi } from "@/lib/api/students.api";
import { useFields, useProfessors, useLevels, useGroups, useStudents } from "@/hooks/use-queries";
import { useGenerateInvoiceForStudent } from "@/hooks/use-financial";
import { useViewMode } from "@/hooks/use-view-mode";
import type { Student } from "@/types";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ViewToggle } from "@/components/shared/view-toggle";
import { TreeView, buildStudentTree } from "@/components/shared/tree-view";
import { ConfirmDeleteDialog, FormButton } from "@/components/forms/form-helpers";
import Tooltip from "@/components/shared/tooltip";
import StudentDetailModal from "@/components/shared/student-detail-modal";
import { StudentAssignmentsCell, StudentFeeCell } from "@/components/shared/student-assignments";
import { formatCurrency, formatDate, studentTotalFee } from "@/lib/utils/format";
import { normalizeTunisianPhone, TUNISIA_PHONE_PLACEHOLDER } from "@/lib/utils/phone";
import { useTranslation } from "@/lib/i18n/context";

export default function StudentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { viewMode, setViewMode } = useViewMode("list");
  const [search, setSearch] = useState("");
  const [fieldId, setFieldId] = useState("");
  const [profId, setProfId] = useState("");
  const [levelId, setLevelId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [treeStudentId, setTreeStudentId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const selectedStudentId = searchParams.get("studentId") || "";

  const { data: fields } = useFields();
  const { data: professors } = useProfessors(fieldId || undefined);
  const { data: levels } = useLevels();
  const { data: groups } = useGroups(profId || undefined);
  const { data: allStudents, isLoading } = useStudents();

  const [deleteError, setDeleteError] = useState("");

  const deleteMutation = useMutation({
    mutationFn: (id: string) => studentsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setDeleteId(null);
    },
    onError: (err: any) => {
      setDeleteError(
        err?.response?.data?.error?.message ??
          t("students.deleteFailed", "Could not delete this student"),
      );
    },
  });

  const filteredStudents = useMemo(() => {
    if (!allStudents) return [];
    return allStudents.filter((student) => {
      const matchesSearch =
        search === "" ||
        `${student.first_name} ${student.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
        student.phone.includes(search) ||
        (student.email?.toLowerCase().includes(search.toLowerCase()) ?? false);

      const matchesField = !fieldId || student.group?.professor?.field?.id === fieldId;
      const matchesProf = !profId || student.group?.professor?.id === profId;
      const matchesLevel = !levelId || student.group?.professor?.field?.level?.id === levelId;
      const matchesGroup = !groupId || student.group?.id === groupId;
      const matchesStatus = statusFilter === "all" || student.status === statusFilter;

      return matchesSearch && matchesField && matchesProf && matchesLevel && matchesGroup && matchesStatus;
    });
  }, [allStudents, search, fieldId, profId, levelId, groupId, statusFilter]);

  const treeData = useMemo(() => buildStudentTree(filteredStudents), [filteredStudents]);

  const clearFilters = () => {
    setFieldId("");
    setProfId("");
    setLevelId("");
    setGroupId("");
    setStatusFilter("all");
    setSearch("");
  };

  const hasFilters = fieldId || profId || levelId || groupId || statusFilter !== "all" || search;

  const openStudent = (id: string) => {
    router.push(`/students?studentId=${id}`);
  };

  const closeStudent = () => {
    router.push("/students");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Link href="/dashboard" className="hover:text-primary">{t("nav.dashboard")}</Link>
        <ChevronRight size={14} />
        <span className="text-text-primary font-medium">{t("nav.students")}</span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-h4 font-bold text-text-primary">{t("students.allStudents")}</h2>
          <p className="text-xs text-text-secondary">{t("students.subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <ViewToggle value={viewMode} onChange={setViewMode} />
          <button className="btn btn-primary" onClick={() => setAddModalOpen(true)}>
            <Plus size={16} /> {t("students.addStudent", "Add Student")}
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="card">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              placeholder={t("students.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9 w-full"
            />
          </div>
          <select value={fieldId} onChange={(e) => { setFieldId(e.target.value); setProfId(""); setLevelId(""); setGroupId(""); }} className="input w-auto min-w-[150px]">
            <option value="">{t("students.allFields")}</option>
            {fields?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select value={profId} onChange={(e) => { setProfId(e.target.value); setLevelId(""); setGroupId(""); }} disabled={!fieldId} className="input w-auto min-w-[150px] disabled:opacity-50">
            <option value="">{t("students.allProfessors")}</option>
            {professors?.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <select value={levelId} onChange={(e) => { setLevelId(e.target.value); setGroupId(""); }} disabled={!profId} className="input w-auto min-w-[150px] disabled:opacity-50">
            <option value="">{t("students.allLevels")}</option>
            {levels?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
           <select value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={!profId} className="input w-auto min-w-[150px] disabled:opacity-50">
            <option value="">{t("students.allGroups")}</option>
            {groups?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input w-auto min-w-[120px]">
            <option value="all">{t("students.allStatus")}</option>
            <option value="active">{t("students.active")}</option>
            <option value="paused">{t("students.paused")}</option>
            <option value="withdrawn">{t("students.withdrawn")}</option>
          </select>
          {hasFilters && (
            <button onClick={clearFilters} className="btn btn-secondary text-xs">
              {t("students.clearFilters")}
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <LoadingSkeleton key={i} type="table-row" />
          ))}
        </div>
      ) : filteredStudents.length === 0 ? (
        <EmptyState
          message={t("students.noStudentsFound")}
          actionLabel={hasFilters ? t("students.clearFilters") : t("students.addStudent", "Add Student")}
          onAction={hasFilters ? clearFilters : () => setAddModalOpen(true)}
        />
      ) : viewMode === "tree" ? (
        <TreeView
          data={treeData}
          onSelect={(node) => {
            if (node.type === "field") router.push(`/hierarchy/field/${node.id}`);
            if (node.type === "professor") router.push(`/professors`);
            if (node.type === "level") router.push(`/levels`);
            if (node.type === "group") router.push(`/groups`);
          }}
          onStudentSelect={(student) => setTreeStudentId(student.id)}
        />
      ) : viewMode === "cards" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStudents.map((student) => (
            <div key={student.id} className="card hover:shadow-hover transition-shadow">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-text-primary">{student.first_name} {student.last_name}</h3>
                  <p className="text-sm text-text-secondary">{student.phone}</p>
                </div>
                <StatusBadge status={student.status} />
              </div>
              <div className="mt-3 space-y-1 text-sm">
                <p className="text-text-secondary"><span className="font-medium">{t("students.groupLabel")}</span> <StudentAssignmentsCell student={student} /></p>
                 <p className="text-text-secondary"><span className="font-medium">{t("students.fieldLabel")}</span> {student.group?.professor?.field?.name ?? "—"}</p>
                <p className="text-text-secondary"><span className="font-medium">{t("students.feeLabel")}</span> {formatCurrency(studentTotalFee(student))}</p>
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={() => openStudent(student.id)} className="btn btn-secondary text-xs flex-1">{t("students.viewDetails")}</button>
                <Link href={`/students/${student.id}/payments`} className="btn btn-primary text-xs flex-1">{t("students.payments")}</Link>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-table border border-border shadow-card">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-background">
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("students.name")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("students.phone")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("students.group")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("students.field")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("students.fee")}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("students.status")}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase">{t("students.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredStudents.map((student) => (
                <tr key={student.id} className="hover:bg-background/50 transition-colors">
                  <td className="px-4 py-3">
                    <button onClick={() => openStudent(student.id)} className="text-primary hover:underline font-medium">{student.first_name} {student.last_name}</button>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{student.phone}</td>
                  <td className="px-4 py-3"><StudentAssignmentsCell student={student} /></td>
                  <td className="px-4 py-3 text-text-secondary">{student.group?.professor?.field?.name ?? "—"}</td>
                  <td className="px-4 py-3"><StudentFeeCell student={student} /></td>
                  <td className="px-4 py-3"><StatusBadge status={student.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Tooltip text={t("students.viewDetails")}>
                        <button onClick={() => openStudent(student.id)} className="h-8 w-8 inline-flex items-center justify-center rounded-btn bg-primary-50 dark:bg-primary/10 text-primary hover:bg-primary-100 dark:hover:bg-primary/20 transition-colors">
                          <Eye size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip text={t("students.payments")}>
                        <Link href={`/students/${student.id}/payments`} className="h-8 w-8 inline-flex items-center justify-center rounded-btn bg-gold-50 dark:bg-gold/10 text-gold-700 dark:text-gold-400 hover:bg-gold-100 dark:hover:bg-gold/20 transition-colors">
                          <DollarSign size={14} />
                        </Link>
                      </Tooltip>
                      <div className="w-px h-4 bg-border mx-1" />
                      <Tooltip text={t("students.delete")}>
                        <button onClick={() => setDeleteId(student.id)} className="h-8 w-8 inline-flex items-center justify-center rounded-btn bg-danger-soft dark:bg-danger/10 text-danger hover:bg-red-100 dark:hover:bg-danger/20 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <StudentDetailModal studentId={selectedStudentId} isOpen={!!selectedStudentId} onClose={closeStudent} />

      <ConfirmDeleteDialog
        entityName={t("students.entityName")}
        isOpen={!!deleteId}
        onClose={() => {
          setDeleteId(null);
          setDeleteError("");
        }}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        error={deleteError}
        isDeleting={deleteMutation.isPending}
      />

      {addModalOpen && (
        <AddStudentModal
          isOpen={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          onSuccess={(studentId?: string) => {
            queryClient.invalidateQueries();
            setAddModalOpen(false);
            if (studentId) {
              router.push(`/students/${studentId}/payments`);
            }
          }}
        />
      )}
      <StudentDetailModal
        studentId={treeStudentId ?? ""}
        isOpen={!!treeStudentId}
        onClose={() => setTreeStudentId(null)}
      />
    </div>
  );
}

function AddStudentModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (studentId?: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const generatePayment = useGenerateInvoiceForStudent();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [email, setEmail] = useState("");
  const [monthlyFee, setMonthlyFee] = useState("");
  const [enrollmentDate, setEnrollmentDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [fieldId, setFieldId] = useState("");
  const [profId, setProfId] = useState("");
  const [levelId, setLevelId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [error, setError] = useState("");

  const { data: fields } = useFields();
  const { data: professors } = useProfessors(fieldId || undefined);
  const { data: levels } = useLevels();
  const { data: groups } = useGroups(profId || undefined);

  const createMutation = useMutation({
    mutationFn: (data: any) => studentsApi.create(data),
    onSuccess: (student) => {
      queryClient.invalidateQueries();
      generatePayment.mutate({ studentId: student.id, months: 0 }, {
        onSuccess: () => {
          onSuccess(student.id);
        },
      });
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message || t("students.createFailed", "Failed to create student"));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!firstName.trim() || !lastName.trim() || !phone.trim() || !groupId || !monthlyFee || !enrollmentDate) {
      setError(t("students.fillRequired", "Please fill in all required fields"));
      return;
    }

    const phoneValue = normalizeTunisianPhone(phone);
    if (!phoneValue) {
      setError(t("students.phoneInvalid", "Phone must be 8 digits, e.g. +216 22 123 456"));
      return;
    }
    const parentPhoneValue = parentPhone.trim() ? normalizeTunisianPhone(parentPhone) : null;
    if (parentPhone.trim() && !parentPhoneValue) {
      setError(t("students.parentPhoneInvalid", "Parent phone must be 8 digits, e.g. +216 22 123 456"));
      return;
    }

    createMutation.mutate({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phoneValue,
      parent_phone: parentPhoneValue,
      email: email.trim() || null,
      monthly_fee: parseFloat(monthlyFee),
      group_id: groupId,
      enrollment_date: enrollmentDate,
      status: "active",
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-h4 font-bold text-text-primary">{t("students.addStudent", "Add Student")}</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-danger-soft dark:bg-danger/10 border border-danger/20 rounded-btn text-danger dark:text-danger-dark text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t("students.firstName", "First Name")} *</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="input"
                placeholder={t("students.firstNamePlaceholder", "First name")}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t("students.lastName", "Last Name")} *</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="input"
                placeholder={t("students.lastNamePlaceholder", "Last name")}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t("students.phone")} *</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="input"
                placeholder={TUNISIA_PHONE_PLACEHOLDER}
                inputMode="tel"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t("students.parentPhone", "Parent Phone")}</label>
              <input
                type="tel"
                value={parentPhone}
                onChange={(e) => setParentPhone(e.target.value)}
                className="input"
                placeholder={TUNISIA_PHONE_PLACEHOLDER}
                inputMode="tel"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t("students.email")}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder={t("students.emailPlaceholder", "Optional")}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t("students.group")} *</label>
            <div className="grid grid-cols-2 gap-3">
              <select value={fieldId} onChange={(e) => { setFieldId(e.target.value); setProfId(""); setLevelId(""); setGroupId(""); }} className="input text-sm">
                <option value="">{t("students.selectField", "Select field")}</option>
                {fields?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <select value={profId} onChange={(e) => { setProfId(e.target.value); setLevelId(""); setGroupId(""); }} disabled={!fieldId} className="input text-sm disabled:opacity-50">
                <option value="">{t("students.selectProfessor", "Select professor")}</option>
                {professors?.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
              <select value={levelId} onChange={(e) => { setLevelId(e.target.value); setGroupId(""); }} disabled={!profId} className="input text-sm disabled:opacity-50">
                <option value="">{t("students.selectLevel", "Select level")}</option>
                {levels?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
               <select value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={!profId} className="input text-sm disabled:opacity-50">
                <option value="">{t("students.selectGroup", "Select group")}</option>
                {groups?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t("students.monthlyFee", "Monthly Fee")} *</label>
            <input
              type="number"
              value={monthlyFee}
              onChange={(e) => setMonthlyFee(e.target.value)}
              className="input"
              placeholder={t("students.feePlaceholder", "0.00")}
              min="0"
              step="0.01"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">{t("students.enrollmentDate", "Enrollment Date")} *</label>
            <input
              type="date"
              value={enrollmentDate}
              onChange={(e) => setEnrollmentDate(e.target.value)}
              className="input"
              required
            />
          </div>

          <div className="flex gap-3 justify-end pt-3 border-t border-border">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t("fields.cancel")}
            </button>
            <FormButton type="submit" isLoading={createMutation.isPending}>
              {t("students.addStudent", "Add Student")}
            </FormButton>
          </div>
        </form>
      </div>
    </div>
  );
}
