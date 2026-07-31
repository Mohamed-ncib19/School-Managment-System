"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Pencil, Trash2, ChevronRight } from "lucide-react";
import { levelsApi } from "@/lib/api/levels.api";
import { useFields, useProfessors } from "@/hooks/use-queries";
import type { Level } from "@/types";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { FormButton, ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import { useTranslation } from "@/lib/i18n/context";

export default function ProfessorLevelsPage() {
  const { t } = useTranslation();
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const fieldId = params.fieldId as string;
  const profId = params.profId as string;

  const { data: levels, isLoading } = useQuery({
    queryKey: ["levels", profId],
    queryFn: () => levelsApi.list(profId),
  });

  const { data: fields } = useFields();
  const { data: professors } = useProfessors(fieldId);
  const field = fields?.find((f) => f.id === fieldId);
  const prof = professors?.find((p) => p.id === profId);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: { prof_id: string; name: string }) => levelsApi.create(data),
    onSuccess: () => { qc.invalidateQueries(); setCreateOpen(false); setName(""); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => levelsApi.update(id, { name }),
    onSuccess: () => { qc.invalidateQueries(); setEditingId(null); setEditName(""); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => levelsApi.delete(id),
    onSuccess: () => { qc.invalidateQueries(); setDeleteId(null); },
  });

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Link href="/fields" className="hover:text-primary">{t("fieldsHierarchy.breadcrumbFields")}</Link>
          <ChevronRight size={14} />
          <Link href={`/fields/${fieldId}/professors`} className="hover:text-primary">{field?.name ?? t("fieldsHierarchy.breadcrumbFields")}</Link>
          <ChevronRight size={14} />
          <span className="text-text-primary font-medium">{prof?.full_name ?? t("fieldsHierarchy.breadcrumbProfessors")}</span>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="h-9 w-9 flex items-center justify-center rounded-btn hover:bg-neutral-soft" aria-label={t("fieldsHierarchy.goBack")}>
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
             <h2 className="text-h4 font-bold text-text-primary">{prof?.full_name ?? t("fieldsHierarchy.levelsTitle")}</h2>
             <p className="text-xs text-text-secondary">{t("fieldsHierarchy.levelsSubtitle")}</p>
          </div>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={16} /> {t("fieldsHierarchy.createLevel")}
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <LoadingSkeleton key={i} type="table-row" />
            ))}
          </div>
        ) : !levels?.length ? (
          <EmptyState message={t("fieldsHierarchy.noLevelsYet")} actionLabel={t("fieldsHierarchy.createLevel")} onAction={() => setCreateOpen(true)} />
        ) : (
          <div className="overflow-hidden rounded-table border border-border shadow-card">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.name")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("students.professor")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {levels?.map((level) => (
                  <tr
                    key={level.id}
                    onClick={() => router.push(`/fields/${fieldId}/professors/${profId}/levels/${level.id}/groups`)}
                    className="hover:bg-background/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      {editingId === level.id ? (
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="input py-1 px-2 text-sm"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          onBlur={() => {
                            if (editName.trim()) {
                              updateMutation.mutate({ id: level.id, name: editName.trim() });
                            } else {
                              setEditingId(null);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && editName.trim()) {
                              updateMutation.mutate({ id: level.id, name: editName.trim() });
                            } else if (e.key === "Escape") {
                              setEditingId(null);
                            }
                          }}
                        />
                      ) : (
                        <span className="font-medium text-primary">{level.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {level.professor ? (
                        <Link href={`/fields/${fieldId}/professors/${profId}`} className="text-primary hover:underline">
                          {level.professor.full_name}
                        </Link>
                      ) : (
                        <span className="text-text-secondary">{t("fieldsHierarchy.dash")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingId(level.id); setEditName(level.name); }}
                          className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors"
                          aria-label={t("fieldsHierarchy.editLevel")}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteId(level.id); }}
                          className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-red-50 transition-colors"
                          aria-label={t("fieldsHierarchy.deleteLevel", "Delete level")}
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
        )}
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCreateOpen(false)}>
          <div className="bg-surface rounded-modal shadow-hover p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-h4 font-bold mb-4">{t("fieldsHierarchy.createLevel")}</h3>
            <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) createMutation.mutate({ prof_id: profId, name: name.trim() }); }} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.name")}</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="input" autoFocus />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>{t("fieldsHierarchy.cancel")}</button>
                <FormButton type="submit" isLoading={createMutation.isPending}>{t("fieldsHierarchy.create")}</FormButton>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog entityName={t("fieldsHierarchy.entityName")} isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && deleteMutation.mutate(deleteId)} />
    </>
  );
}
