"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, BookOpen, Users, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { fieldsApi } from "@/lib/api/fields.api";
import { useProfessors, useLevels, useGroups, useStudents } from "@/hooks/use-queries";
import { useViewMode } from "@/hooks/use-view-mode";
import type { Field, Professor, Level, Group, Student } from "@/types";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDeleteDialog, FormButton } from "@/components/forms/form-helpers";
import { ViewToggle } from "@/components/shared/view-toggle";
import { TreeView, buildFieldsTree } from "@/components/shared/tree-view";
import { useTranslation } from "@/lib/i18n/context";

export default function FieldsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const router = useRouter();
  const { data: fields, isLoading, error } = useQuery({ queryKey: ["fields"], queryFn: fieldsApi.list });
  const { data: professors } = useProfessors();
  const { data: levels } = useLevels();
  const { data: groups } = useGroups();
  const { data: students } = useStudents();

  const { viewMode, setViewMode } = useViewMode("cards");

  const statsMap = useMemo(() => {
    const map: Record<string, { professors: number; levels: number; groups: number; students: number }> = {};
    fields?.forEach((f) => { map[f.id] = { professors: 0, levels: 0, groups: 0, students: 0 }; });
    professors?.forEach((p) => { if (map[p.field_id]) map[p.field_id].professors++; });
    levels?.forEach((l) => {
      const prof = professors?.find((p) => p.id === l.prof_id);
      if (prof && map[prof.field_id]) map[prof.field_id].levels++;
    });
    groups?.forEach((g) => {
      const level = levels?.find((l) => l.id === g.level_id);
      const prof = level ? professors?.find((p) => p.id === level.prof_id) : undefined;
      if (prof && map[prof.field_id]) map[prof.field_id].groups++;
    });
    students?.forEach((s) => {
      const group = groups?.find((g) => g.id === s.group_id);
      const level = group ? levels?.find((l) => l.id === group.level_id) : undefined;
      const prof = level ? professors?.find((p) => p.id === level.prof_id) : undefined;
      if (prof && map[prof.field_id]) map[prof.field_id].students++;
    });
    return map;
  }, [fields, professors, levels, groups, students]);

  const treeData = useMemo(
    () => buildFieldsTree(fields ?? [], professors ?? [], levels ?? [], groups ?? [], students ?? []),
    [fields, professors, levels, groups, students],
  );

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingField, setEditingField] = useState<Field | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const resetForm = () => { setName(""); setDescription(""); setEditingField(null); };

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) => fieldsApi.create(data),
    onSuccess: () => { qc.invalidateQueries(); setFormOpen(false); resetForm(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; description?: string } }) => fieldsApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries(); setFormOpen(false); resetForm(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fieldsApi.remove(id),
    onSuccess: () => { qc.invalidateQueries(); setDeleteId(null); },
  });

  const openEdit = (field: Field) => {
    setEditingField(field);
    setName(field.name);
    setDescription(field.description ?? "");
    setFormOpen(true);
  };

  const openCreate = () => { resetForm(); setFormOpen(true); };

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-h2 font-bold text-text-primary">{t("fields.title")}</h2>
            <p className="text-sm text-text-secondary mt-1">{t("fields.subtitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            <ViewToggle value={viewMode} onChange={setViewMode} />
            <button className="btn btn-primary" onClick={openCreate}>
              <Plus size={16} /> {t("fields.newField")}
            </button>
          </div>
        </div>

        {isLoading ? (
          <LoadingSkeleton type="card" className="h-64" />
        ) : error ? (
          <div className="card text-center py-12 text-danger text-sm">{t("fields.failedToLoad")}</div>
        ) : fields?.length === 0 ? (
          <EmptyState message={t("fields.noFieldsYet")} actionLabel={t("fields.createField")} onAction={openCreate} />
        ) : viewMode === "tree" ? (
          <TreeView data={treeData} onSelect={(node) => {
            if (node.type === "field") router.push(`/fields/${node.id}/professors`);
            if (node.type === "professor") router.push(`/fields/${node.meta?.field_id}/professors/${node.id}/levels`);
            if (node.type === "level") router.push(`/fields/${node.meta?.field_id}/professors/${node.meta?.prof_id}/levels/${node.id}/groups`);
            if (node.type === "group") router.push(`/fields/${node.meta?.field_id}/professors/${node.meta?.prof_id}/levels/${node.meta?.level_id}/groups/${node.id}/students`);
          }} />
        ) : viewMode === "list" ? (
          <div className="space-y-2">
            {fields?.map((field) => {
              const stats = statsMap[field.id] ?? { professors: 0, levels: 0, groups: 0, students: 0 };
              return (
                <div key={field.id} className="card hover:shadow-hover transition-all duration-150 group flex items-center justify-between">
                  <Link href={`/fields/${field.id}/professors`} className="flex-1 block">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
                        <BookOpen size={18} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-text-primary group-hover:text-primary transition-colors">{field.name}</h3>
                        <p className="text-xs text-text-secondary mt-0.5">{field.description ?? t("fields.noDescription")}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-3">
                      <div className="text-center">
                        <p className="text-sm font-bold text-text-primary">{stats.professors}</p>
                        <p className="text-[10px] uppercase tracking-wider text-text-secondary">{t("fieldsHierarchy.breadcrumbProfessors")}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-text-primary">{stats.levels}</p>
                        <p className="text-[10px] uppercase tracking-wider text-text-secondary">{t("fieldsHierarchy.breadcrumbLevels")}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-text-primary">{stats.groups}</p>
                        <p className="text-[10px] uppercase tracking-wider text-text-secondary">{t("fieldsHierarchy.breadcrumbGroups")}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-text-primary">{stats.students}</p>
                        <p className="text-[10px] uppercase tracking-wider text-text-secondary">{t("fieldsHierarchy.breadcrumbStudents")}</p>
                      </div>
                    </div>
                  </Link>
                  <div className="flex items-center gap-1 mr-3">
                    <button
                      onClick={(e) => { e.preventDefault(); openEdit(field); }}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 dark:hover:bg-primary/10 transition-colors"
                      aria-label={t("fields.editField", "Edit field")}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={(e) => { e.preventDefault(); setDeleteId(field.id); }}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-danger-soft dark:hover:bg-danger/10 transition-colors"
                      aria-label={t("fields.deleteField", "Delete field")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {fields?.map((field) => {
              const stats = statsMap[field.id] ?? { professors: 0, levels: 0, groups: 0, students: 0 };
              return (
                <div key={field.id} className="card hover:shadow-hover transition-all duration-150 group">
                  <Link href={`/fields/${field.id}/professors`} className="block">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
                          <BookOpen size={18} />
                        </div>
                        <div>
                          <h3 className="font-semibold text-text-primary group-hover:text-primary transition-colors">{field.name}</h3>
                          <p className="text-xs text-text-secondary mt-0.5">{field.description ?? t("fields.noDescription")}</p>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-text-secondary shrink-0 mt-1" />
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-4 pt-4 border-t border-border">
                      <div className="text-center">
                        <p className="text-sm font-bold text-text-primary">{stats.professors}</p>
                        <p className="text-[10px] uppercase tracking-wider text-text-secondary">{t("fieldsHierarchy.breadcrumbProfessors")}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-text-primary">{stats.levels}</p>
                        <p className="text-[10px] uppercase tracking-wider text-text-secondary">{t("fieldsHierarchy.breadcrumbLevels")}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-text-primary">{stats.groups}</p>
                        <p className="text-[10px] uppercase tracking-wider text-text-secondary">{t("fieldsHierarchy.breadcrumbGroups")}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-text-primary">{stats.students}</p>
                        <p className="text-[10px] uppercase tracking-wider text-text-secondary">{t("fieldsHierarchy.breadcrumbStudents")}</p>
                      </div>
                    </div>
                  </Link>
                  <div className="flex items-center justify-end gap-1 mt-3 pt-3 border-t border-border">
                    <button
                      onClick={(e) => { e.preventDefault(); openEdit(field); }}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 dark:hover:bg-primary/10 transition-colors"
                      aria-label={t("fields.editField", "Edit field")}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={(e) => { e.preventDefault(); setDeleteId(field.id); }}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-danger-soft dark:hover:bg-danger/10 transition-colors"
                      aria-label={t("fields.deleteField", "Delete field")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {formOpen && (
        <div className="modal-overlay" onClick={() => { setFormOpen(false); resetForm(); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-h4 font-bold mb-4">{editingField ? t("fields.editField", "Edit Field") : t("fields.newField")}</h3>
            <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) {
              if (editingField) {
                updateMutation.mutate({ id: editingField.id, data: { name: name.trim(), description: description || undefined } });
              } else {
                createMutation.mutate({ name: name.trim(), description: description || undefined });
              }
            }}} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("fields.name")}</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("fields.namePlaceholder")} className="input" autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("fields.description")}</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("fields.descriptionPlaceholder")} className="input" rows={2} />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" className="btn btn-secondary" onClick={() => { setFormOpen(false); resetForm(); }}>{t("fields.cancel")}</button>
                <FormButton type="submit" isLoading={createMutation.isPending || updateMutation.isPending}>{editingField ? t("fields.save", "Save") : t("fields.create")}</FormButton>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog entityName={t("fields.field")} isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && deleteMutation.mutate(deleteId)} />
    </>
  );
}
