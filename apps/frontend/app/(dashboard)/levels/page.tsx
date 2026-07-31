"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ChevronRight } from "lucide-react";
import { levelsApi } from "@/lib/api/levels.api";
import { useProfessors, useFields, useGroups, useStudents } from "@/hooks/use-queries";
import type { Level, Professor, Field, Group, Student } from "@/types";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { FormButton, ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import { ViewToggle, type ViewMode } from "@/components/shared/view-toggle";
import { TreeView, buildLevelsTree } from "@/components/shared/tree-view";
import { useTranslation } from "@/lib/i18n/context";

export default function LevelsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const router = useRouter();
  const { data: professors } = useProfessors();
  const { data: fields } = useFields();

  const { data: levels, isLoading } = useQuery({
    queryKey: ["levels"],
    queryFn: () => levelsApi.list(),
  });

  const { data: groups } = useGroups();
  const { data: students } = useStudents();

  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const treeData = useMemo(
    () => buildLevelsTree(levels ?? [], professors ?? [], fields ?? [], groups ?? [], students ?? []),
    [levels, professors, fields, groups, students],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [profId, setProfId] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const profFieldMap = useMemo(() => {
    const map: Record<string, string> = {};
    professors?.forEach((p) => { map[p.id] = p.field_id; });
    return map;
  }, [professors]);

  const fieldNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    fields?.forEach((f) => { map[f.id] = f.name; });
    return map;
  }, [fields]);

  const filteredProfessors = useMemo(() => {
    if (!profId) return professors ?? [];
    return (professors ?? []).filter((p) => p.id === profId);
  }, [profId, professors]);

  const resetForm = () => { setName(""); setProfId(""); setEditingId(null); };

  const createMutation = useMutation({
    mutationFn: (data: { prof_id: string; name: string }) => levelsApi.create(data),
    onSuccess: () => { qc.invalidateQueries(); setCreateOpen(false); resetForm(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => levelsApi.update(id, { name }),
    onSuccess: () => { qc.invalidateQueries(); setEditingId(null); setName(""); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => levelsApi.delete(id),
    onSuccess: () => { qc.invalidateQueries(); setDeleteId(null); },
  });

  const openEdit = (level: Level) => {
    setEditingId(level.id);
    setName(level.name);
    setProfId(level.professor?.id ?? "");
    setCreateOpen(true);
  };

  const openCreate = () => { resetForm(); setCreateOpen(true); };

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-h4 font-bold text-text-primary">{t("fieldsHierarchy.levelsTitle")}</h2>
            <p className="text-xs text-text-secondary mt-1">{t("fieldsHierarchy.levelsSubtitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            <ViewToggle value={viewMode} onChange={setViewMode} />
            <button className="btn btn-primary" onClick={openCreate}>
              <Plus size={16} /> {t("fieldsHierarchy.createLevel")}
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <LoadingSkeleton key={i} type="table-row" />
            ))}
          </div>
        ) : !levels?.length ? (
          <EmptyState message={t("fieldsHierarchy.noLevelsYet")} actionLabel={t("fieldsHierarchy.createLevel")} onAction={openCreate} />
        ) : viewMode === "tree" ? (
          <TreeView data={treeData} onSelect={(node) => {
            if (node.type === "field") router.push(`/fields/${node.id}/professors`);
            if (node.type === "professor") router.push(`/fields/${node.meta?.field_id}/professors/${node.id}/levels`);
            if (node.type === "level") router.push(`/fields/${node.meta?.field_id}/professors/${node.meta?.prof_id}/levels/${node.id}/groups`);
            if (node.type === "group") router.push(`/fields/${node.meta?.field_id}/professors/${node.meta?.prof_id}/levels/${node.meta?.level_id}/groups/${node.id}/students`);
          }} />
        ) : viewMode === "cards" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {levels?.map((level) => (
              <div key={level.id} className="card hover:shadow-hover transition-shadow">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-text-primary">{level.name}</h3>
                    <p className="text-sm text-text-secondary">{level.professor?.full_name ?? "—"}</p>
                  </div>
                </div>
                <div className="mt-3 space-y-1 text-sm">
                  <p className="text-text-secondary"><span className="font-medium">{t("students.professor")}</span> {level.professor?.full_name ?? "—"}</p>
                  <p className="text-text-secondary"><span className="font-medium">{t("fieldsHierarchy.field")}</span> {level.professor?.field?.name ?? "—"}</p>
                </div>
                <div className="mt-4 flex gap-2">
                  <button onClick={() => openEdit(level)} className="btn btn-secondary text-xs flex-1">{t("fieldsHierarchy.editLevel")}</button>
                  {level.professor && (
                    <Link href={`/fields/${level.professor.field_id}/professors/${level.professor.id}/levels/${level.id}/groups`} className="btn btn-primary text-xs flex-1">{t("fieldsHierarchy.viewGroups")}</Link>
                  )}
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
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("students.professor")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.field")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {levels?.map((level) => (
                  <tr key={level.id} className="hover:bg-background/50 transition-colors">
                    <td className="px-4 py-3">
                      {editingId === level.id ? (
                        <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="input py-1 px-2 text-sm"
                          autoFocus
                          onBlur={() => {
                            if (name.trim()) {
                              updateMutation.mutate({ id: level.id, name: name.trim() });
                            } else {
                              setEditingId(null);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && name.trim()) {
                              updateMutation.mutate({ id: level.id, name: name.trim() });
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
                        <Link href={`/fields/${level.professor.field_id}/professors/${level.professor.id}`} className="text-primary hover:underline">
                          {level.professor.full_name}
                        </Link>
                      ) : (
                        <span className="text-text-secondary">{t("fieldsHierarchy.dash")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {level.professor?.field ? (
                        <Link href={`/fields/${level.professor.field.id}`} className="text-primary hover:underline">
                          {level.professor.field.name}
                        </Link>
                      ) : (
                        <span className="text-text-secondary">{t("fieldsHierarchy.dash")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(level)}
                          className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors"
                          aria-label={t("fieldsHierarchy.editLevel")}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setDeleteId(level.id)}
                          className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-red-50 transition-colors"
                          aria-label={t("fieldsHierarchy.deleteLevel", "Delete level")}
                        >
                          <Trash2 size={14} />
                        </button>
                        {level.professor && (
                          <Link href={`/fields/${level.professor.field_id}/professors/${level.professor.id}/levels/${level.id}/groups`} className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors">
                            <ChevronRight size={14} />
                          </Link>
                        )}
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
            <h3 className="text-h4 font-bold mb-4">{editingId ? t("fieldsHierarchy.editLevel", "Edit Level") : t("fieldsHierarchy.createLevel")}</h3>
            <form onSubmit={(e) => { e.preventDefault(); if (name.trim() && profId) {
              if (editingId) {
                updateMutation.mutate({ id: editingId, name: name.trim() });
              } else {
                createMutation.mutate({ prof_id: profId, name: name.trim() });
              }
            }}} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("students.selectProfessor", "Select professor")} *</label>
                <select value={profId} onChange={(e) => setProfId(e.target.value)} className="input" required>
                  <option value="">{t("students.selectProfessor", "Select professor")}</option>
                  {professors?.map((p) => <option key={p.id} value={p.id}>{p.full_name} — {fieldNameMap[p.field_id] ?? ""}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.name")} *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="input" required autoFocus />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>{t("fieldsHierarchy.cancel")}</button>
                <FormButton type="submit" isLoading={createMutation.isPending || updateMutation.isPending}>{editingId ? t("fieldsHierarchy.save", "Save") : t("fieldsHierarchy.create")}</FormButton>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog entityName={t("fieldsHierarchy.entityName")} isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && deleteMutation.mutate(deleteId)} />
    </>
  );
}
