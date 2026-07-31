"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { professorsApi } from "@/lib/api/professors.api";
import { useFields } from "@/hooks/use-queries";
import type { Professor } from "@/types";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { FormButton, ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import { useTranslation } from "@/lib/i18n/context";

export default function FieldProfessorsPage() {
  const { t } = useTranslation();
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const fieldId = params.fieldId as string;

  const { data: professors, isLoading } = useQuery({
    queryKey: ["professors", fieldId],
    queryFn: () => professorsApi.list(fieldId),
  });

  const { data: fields } = useFields();
  const field = fields?.find((f) => f.id === fieldId);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingProf, setEditingProf] = useState<Professor | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const resetForm = () => { setFullName(""); setPhone(""); setEmail(""); setEditingProf(null); };

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
    setCreateOpen(true);
  };

  const openCreate = () => { resetForm(); setCreateOpen(true); };

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <button onClick={() => router.push("/fields")} className="hover:text-primary">{t("fieldsHierarchy.breadcrumbFields")}</button>
          <ChevronRight size={14} />
          <Link href={`/fields/${fieldId}/professors`} className="hover:text-primary font-medium">{field?.name ?? t("fieldsHierarchy.breadcrumbProfessors")}</Link>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="h-9 w-9 flex items-center justify-center rounded-btn hover:bg-neutral-soft" aria-label={t("fieldsHierarchy.goBack")}>
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h2 className="text-h4 font-bold text-text-primary">{field?.name ?? t("fieldsHierarchy.professorsTitle")}</h2>
            <p className="text-xs text-text-secondary">{t("fieldsHierarchy.professorsSubtitle")}</p>
          </div>
          <button className="btn btn-primary" onClick={openCreate}>
            <Plus size={16} /> {t("fieldsHierarchy.newProfessor")}
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <LoadingSkeleton key={i} type="table-row" />
            ))}
          </div>
        ) : !professors?.length ? (
          <EmptyState message={t("fieldsHierarchy.noProfessorsYet")} actionLabel={t("fieldsHierarchy.addProfessor")} onAction={openCreate} />
        ) : (
          <div className="overflow-hidden rounded-table border border-border shadow-card">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.name")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.phone")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.email")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.status")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {professors?.map((prof) => (
                  <tr
                    key={prof.id}
                    onClick={() => router.push(`/fields/${fieldId}/professors/${prof.id}/levels`)}
                    className="hover:bg-background/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-primary hover:underline">{prof.full_name}</td>
                    <td className="px-4 py-3 text-text-secondary">{prof.phone}</td>
                    <td className="px-4 py-3 text-text-secondary">{prof.email ?? t("fieldsHierarchy.dash")}</td>
                    <td className="px-4 py-3">{prof.is_active ? <span className="text-xs font-medium text-success-strong">Active</span> : <span className="text-xs font-medium text-text-secondary">Inactive</span>}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); openEdit(prof); }}
                          className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors"
                          aria-label={t("fieldsHierarchy.editProfessor", "Edit professor")}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteId(prof.id); }}
                          className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-red-50 transition-colors"
                          aria-label={t("fieldsHierarchy.deleteProfessor", "Delete professor")}
                        >
                          <Trash2 size={14} />
                        </button>
                        <span className="flex items-center gap-1 text-text-secondary ml-1">
                          {t("fieldsHierarchy.viewLevels")} <ChevronRight size={14} />
                        </span>
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
            <form onSubmit={(e) => { e.preventDefault(); if (fullName.trim()) {
              if (editingProf) {
                updateMutation.mutate({ id: editingProf.id, data: { full_name: fullName.trim(), phone: phone.trim(), email: email.trim() || undefined } });
              } else {
                createMutation.mutate({ field_id: fieldId, full_name: fullName.trim(), phone: phone.trim(), email: email.trim() || undefined });
              }
            }}} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.fullName")}</label>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="input" autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.phone")}</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" />
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

      <ConfirmDeleteDialog entityName={t("fieldsHierarchy.entityName")} isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && deactivateMutation.mutate(deleteId)} />
    </>
  );
}
