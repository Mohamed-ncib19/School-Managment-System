"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ChevronRight } from "lucide-react";
import { professorsApi } from "@/lib/api/professors.api";
import { useFields, useLevels, useGroups, useStudents } from "@/hooks/use-queries";
import { useViewMode } from "@/hooks/use-view-mode";
import type { Professor, Field, Level, Group, Student } from "@/types";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { FormButton, ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import DeletedEntities from "@/components/hierarchy/deleted-entities";
import { ViewToggle } from "@/components/shared/view-toggle";
import { TreeView, buildProfessorsTree } from "@/components/shared/tree-view";
import { normalizeTunisianPhone, TUNISIA_PHONE_PLACEHOLDER } from "@/lib/utils/phone";
import { useTranslation } from "@/lib/i18n/context";

export default function ProfessorsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const router = useRouter();
  const { data: fields } = useFields();
  const { data: professors, isLoading } = useQuery({
    queryKey: ["professors"],
    queryFn: () => professorsApi.list(),
  });

  const { data: levels } = useLevels();
  const { data: groups } = useGroups();
  const { data: students } = useStudents();

  const { viewMode, setViewMode } = useViewMode("list");

  const treeData = useMemo(
    () => buildProfessorsTree(professors ?? [], fields ?? [], levels ?? [], groups ?? [], students ?? []),
    [professors, fields, levels, groups, students],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [editingProf, setEditingProf] = useState<Professor | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fieldId, setFieldId] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [deletedOpen, setDeletedOpen] = useState(false);

  const resetForm = () => { setFullName(""); setPhone(""); setEmail(""); setFieldId(""); setEditingProf(null); };

  const createMutation = useMutation({
    mutationFn: (data: any) => professorsApi.create(data),
    onSuccess: () => { qc.invalidateQueries(); setCreateOpen(false); resetForm(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => professorsApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries(); setCreateOpen(false); resetForm(); },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => professorsApi.deactivate(id),
    onSuccess: () => { qc.invalidateQueries(); setDeleteId(null); },
  });

  const openEdit = (prof: Professor) => {
    setEditingProf(prof);
    setFullName(prof.full_name);
    setPhone(prof.phone);
    setEmail(prof.email ?? "");
    setFieldId(prof.field_id);
    setCreateOpen(true);
  };

  const openCreate = () => { resetForm(); setCreateOpen(true); };

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-h4 font-bold text-text-primary">{t("fieldsHierarchy.professorsTitle")}</h2>
            <p className="text-xs text-text-secondary mt-1">{t("fieldsHierarchy.professorsSubtitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            <ViewToggle value={viewMode} onChange={setViewMode} />
            <button className="btn btn-secondary" onClick={() => setDeletedOpen(true)} title={t("deleted.title", "Deleted")}>
              <Trash2 size={16} /> {t("deleted.title", "Deleted")}
            </button>
            <button className="btn btn-primary" onClick={openCreate}>
              <Plus size={16} /> {t("fieldsHierarchy.newProfessor")}
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <LoadingSkeleton key={i} type="table-row" />
            ))}
          </div>
        ) : !professors?.length ? (
          <EmptyState message={t("fieldsHierarchy.noProfessorsYet")} actionLabel={t("fieldsHierarchy.addProfessor")} onAction={openCreate} />
        ) : viewMode === "tree" ? (
          <TreeView data={treeData} onSelect={(node) => {
            if (node.type === "field") router.push(`/hierarchy/field/${node.id}`);
            if (node.type === "professor") router.push(`/hierarchy/field/${node.meta?.field_id}/professor/${node.id}`);
            if (node.type === "level") router.push(`/hierarchy/field/${node.meta?.field_id}/professor/${node.meta?.prof_id}/level/${node.id}`);
            if (node.type === "group") router.push(`/hierarchy/field/${node.meta?.field_id}/professor/${node.meta?.prof_id}/level/${node.meta?.level_id}/group/${node.id}`);
          }} />
        ) : viewMode === "cards" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {professors?.map((prof) => (
              <div
                key={prof.id}
                className="card group cursor-pointer hover:shadow-hover transition-shadow"
                onClick={() => router.push(`/hierarchy/field/${prof.field_id}/professor/${prof.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-text-primary transition-colors group-hover:text-primary">{prof.full_name}</h3>
                    <p className="text-sm text-text-secondary">{prof.phone}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {prof.is_active ? (
                      <span className="text-xs font-medium text-success-strong">Active</span>
                    ) : (
                      <span className="text-xs font-medium text-text-secondary">Inactive</span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteId(prof.id); }}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-danger-soft transition-colors"
                      aria-label={t("fieldsHierarchy.deleteProfessor", "Delete professor")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="mt-3 space-y-1 text-sm">
                  <p className="text-text-secondary"><span className="font-medium">{t("fieldsHierarchy.field")}</span> {prof.field?.name ?? "—"}</p>
                  <p className="text-text-secondary"><span className="font-medium">{t("fieldsHierarchy.email")}</span> {prof.email ?? "—"}</p>
                </div>
                <div className="mt-4 flex gap-2">
                  <button onClick={(e) => { e.stopPropagation(); openEdit(prof); }} className="btn btn-secondary text-xs flex-1">{t("fieldsHierarchy.editProfessor", "Edit")}</button>
                  <Link href={`/hierarchy/field/${prof.field_id}/professor/${prof.id}`} onClick={(e) => e.stopPropagation()} className="btn btn-primary text-xs flex-1 text-center">{t("fieldsHierarchy.viewLevels")}</Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-table border border-border shadow-card">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.name")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.phone")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.email")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.field")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.status")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {professors?.map((prof) => (
                  <tr
                    key={prof.id}
                    className="hover:bg-background/50 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-primary hover:underline">
                      <Link href={`/hierarchy/field/${prof.field_id}/professor/${prof.id}`} className="hover:underline">
                        {prof.full_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{prof.phone}</td>
                    <td className="px-4 py-3 text-text-secondary">{prof.email ?? t("fieldsHierarchy.dash")}</td>
                    <td className="px-4 py-3 text-text-secondary">
                      {prof.field ? (
                        <Link href={`/hierarchy/field/${prof.field_id}`} className="text-primary hover:underline">
                          {prof.field.name}
                        </Link>
                      ) : (
                        <span className="text-text-secondary">{t("fieldsHierarchy.dash")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{prof.is_active ? <span className="text-xs font-medium text-success-strong">Active</span> : <span className="text-xs font-medium text-text-secondary">Inactive</span>}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(prof)}
                          className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors"
                          aria-label={t("fieldsHierarchy.editProfessor", "Edit professor")}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setDeleteId(prof.id)}
                          className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-danger-soft transition-colors"
                          aria-label={t("fieldsHierarchy.deleteProfessor", "Delete professor")}
                        >
                          <Trash2 size={14} />
                        </button>
                        <Link href={`/hierarchy/field/${prof.field_id}/professor/${prof.id}`} className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors">
                          <ChevronRight size={14} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setCreateOpen(false); resetForm(); }}>
          <div className="bg-surface rounded-modal shadow-hover p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-h4 font-bold mb-4">{editingProf ? t("fieldsHierarchy.editProfessor", "Edit Professor") : t("fieldsHierarchy.newProfessor")}</h3>
            <form onSubmit={(e) => { e.preventDefault(); if (fullName.trim() && fieldId) {
              const phoneValue = normalizeTunisianPhone(phone);
              if (!phoneValue) { setFormError(t("students.phoneInvalid", "Phone must be 8 digits, e.g. +216 22 123 456")); return; }
              setFormError("");
              if (editingProf) {
                updateMutation.mutate({ id: editingProf.id, data: { full_name: fullName.trim(), phone: phoneValue, email: email.trim() || undefined, field_id: fieldId } });
              } else {
                createMutation.mutate({ field_id: fieldId, full_name: fullName.trim(), phone: phoneValue, email: email.trim() || undefined });
              }
            }}} className="space-y-3">
              {formError && <p className="text-sm text-danger">{formError}</p>}
              <div>
                <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.field")} *</label>
                <select value={fieldId} onChange={(e) => setFieldId(e.target.value)} className="input" required>
                  <option value="">{t("students.selectField", "Select field")}</option>
                  {fields?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.fullName")} *</label>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="input" required autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.phone")} *</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder={TUNISIA_PHONE_PLACEHOLDER} inputMode="tel" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.emailOptional")}</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" className="btn btn-secondary" onClick={() => { setCreateOpen(false); resetForm(); }}>{t("fieldsHierarchy.cancel")}</button>
                <FormButton type="submit" isLoading={createMutation.isPending || updateMutation.isPending}>{editingProf ? t("fieldsHierarchy.save", "Save") : t("fieldsHierarchy.create")}</FormButton>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog entityName={t("fieldsHierarchy.entityName")} isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && deactivateMutation.mutate(deleteId)} message={t("deleted.confirm", "It will be archived and can be restored later.")} />

      <DeletedEntities entityType="professor" isOpen={deletedOpen} onClose={() => setDeletedOpen(false)} />
    </>
  );
}
