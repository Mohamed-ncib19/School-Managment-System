"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, BookOpen, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { fieldsApi } from "@/lib/api/fields.api";
import { useProfessors, useLevels, useGroups, useStudents, useHierarchySummary } from "@/hooks/use-queries";
import { useViewMode } from "@/hooks/use-view-mode";
import type { Field } from "@/types";
import { CardGridSkeleton } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState, describeError } from "@/components/shared/error-state";
import { ConfirmDeleteDialog, FormButton } from "@/components/forms/form-helpers";
import { ViewToggle } from "@/components/shared/view-toggle";
import { TreeView, buildFieldsTree } from "@/components/shared/tree-view";
import { useToast } from "@/components/shared/toast";
import { useTranslation } from "@/lib/i18n/context";

interface FieldStats {
  professors: number;
  levels: number;
  groups: number;
  students: number;
}

const EMPTY_STATS: FieldStats = { professors: 0, levels: 0, groups: 0, students: 0 };

export default function FieldsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();

  const { viewMode, setViewMode } = useViewMode("cards");

  const { data: fields, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["fields"],
    queryFn: fieldsApi.list,
  });

  // Counts come from SQL. Previously this page downloaded every professor,
  // level, group and student - 421 KB, most of it the 384 KB student list -
  // only to tally them in the browser.
  const { data: summary } = useHierarchySummary();

  /**
   * The tree view is the only mode that needs the full records, so those
   * queries stay disabled until the user actually switches to it.
   */
  const treeEnabled = viewMode === "tree";
  const { data: professors } = useProfessors(undefined, { enabled: treeEnabled });
  const { data: levels } = useLevels(undefined, { enabled: treeEnabled });
  const { data: groups } = useGroups(undefined, { enabled: treeEnabled });
  const { data: students } = useStudents(undefined, { enabled: treeEnabled });

  // Keyed lookup instead of the previous nested `.find()` per row, which was
  // ~15,000 array scans per render at the current roster size.
  const statsMap = useMemo(() => {
    const map = new Map<string, FieldStats>();
    summary?.fields.forEach((f) =>
      map.set(f.id, { professors: f.professors, levels: f.levels, groups: f.groups, students: f.students }),
    );
    return map;
  }, [summary]);

  const treeData = useMemo(
    () => (treeEnabled ? buildFieldsTree(fields ?? [], professors ?? [], levels ?? [], groups ?? [], students ?? []) : []),
    [treeEnabled, fields, professors, levels, groups, students],
  );

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingField, setEditingField] = useState<Field | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const resetForm = useCallback(() => {
    setName("");
    setDescription("");
    setEditingField(null);
  }, []);

  /**
   * Only the affected caches are refreshed. `invalidateQueries()` with no
   * argument invalidated every query in the app, so renaming one field
   * re-fetched the entire student list.
   */
  const refreshHierarchy = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["fields"] });
    qc.invalidateQueries({ queryKey: ["hierarchy-summary"] });
  }, [qc]);

  const showError = useCallback(
    (err: unknown) => {
      const { title, detail } = describeError(err);
      toast.error(title, detail);
    },
    [toast],
  );

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) => fieldsApi.create(data),
    onSuccess: (_result, variables) => {
      refreshHierarchy();
      setFormOpen(false);
      resetForm();
      toast.success("Field created", variables.name);
    },
    onError: showError,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; description?: string } }) => fieldsApi.update(id, data),
    onSuccess: (_result, variables) => {
      refreshHierarchy();
      setFormOpen(false);
      resetForm();
      toast.success("Changes saved", variables.data.name);
    },
    onError: showError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fieldsApi.remove(id),
    onSuccess: () => {
      refreshHierarchy();
      setDeleteId(null);
      toast.success("Field deleted");
    },
    onError: (err) => {
      showError(err);
      setDeleteId(null);
    },
  });

  const openEdit = useCallback((field: Field) => {
    setEditingField(field);
    setName(field.name);
    setDescription(field.description ?? "");
    setFormOpen(true);
  }, []);

  const openCreate = useCallback(() => {
    resetForm();
    setFormOpen(true);
  }, [resetForm]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    // Guard against a second submit while the first is still in flight.
    if (!trimmed || isSaving) return;
    if (editingField) {
      updateMutation.mutate({ id: editingField.id, data: { name: trimmed, description: description || undefined } });
    } else {
      createMutation.mutate({ name: trimmed, description: description || undefined });
    }
  };

  const StatGrid = ({ stats }: { stats: FieldStats }) => (
    <div className="grid grid-cols-4 gap-2">
      {(
        [
          [stats.professors, t("fieldsHierarchy.breadcrumbProfessors")],
          [stats.levels, t("fieldsHierarchy.breadcrumbLevels")],
          [stats.groups, t("fieldsHierarchy.breadcrumbGroups")],
          [stats.students, t("fieldsHierarchy.breadcrumbStudents")],
        ] as const
      ).map(([value, label]) => (
        <div key={label} className="text-center">
          <p className="text-sm font-bold text-text-primary">{value}</p>
          <p className="text-[10px] uppercase tracking-wider text-text-secondary">{label}</p>
        </div>
      ))}
    </div>
  );

  const RowActions = ({ field }: { field: Field }) => (
    <div className="flex items-center gap-1">
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); openEdit(field); }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-btn text-text-secondary transition-colors hover:bg-primary-50 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200 dark:hover:bg-primary/10"
        aria-label={`${t("fields.editField", "Edit field")}: ${field.name}`}
      >
        <Pencil size={14} />
      </button>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteId(field.id); }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-btn text-text-secondary transition-colors hover:bg-danger-soft hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 dark:hover:bg-danger/10"
        aria-label={`${t("fields.deleteField", "Delete field")}: ${field.name}`}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-h2 font-bold text-text-primary">{t("fields.title")}</h2>
            <p className="mt-1 text-sm text-text-secondary">{t("fields.subtitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            <ViewToggle value={viewMode} onChange={setViewMode} />
            <button className="btn btn-primary" onClick={openCreate}>
              <Plus size={16} /> {t("fields.newField")}
            </button>
          </div>
        </div>

        {isPending ? (
          <CardGridSkeleton count={6} columns={3} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} isRetrying={isFetching} />
        ) : fields?.length === 0 ? (
          <EmptyState message={t("fields.noFieldsYet")} actionLabel={t("fields.createField")} onAction={openCreate} />
        ) : viewMode === "tree" ? (
          <TreeView
            data={treeData}
            onSelect={(node) => {
              if (node.type === "field") router.push(`/fields/${node.id}/professors`);
              if (node.type === "professor") router.push(`/fields/${node.meta?.field_id}/professors/${node.id}/levels`);
              if (node.type === "level") router.push(`/fields/${node.meta?.field_id}/professors/${node.meta?.prof_id}/levels/${node.id}/groups`);
              if (node.type === "group") router.push(`/fields/${node.meta?.field_id}/professors/${node.meta?.prof_id}/levels/${node.meta?.level_id}/groups/${node.id}/students`);
            }}
          />
        ) : viewMode === "list" ? (
          <div className="space-y-2">
            {fields?.map((field) => (
              <div key={field.id} className="card group flex items-center justify-between transition-all duration-150 hover:shadow-hover">
                <Link href={`/fields/${field.id}/professors`} className="block flex-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-card bg-primary-50 text-primary dark:bg-primary/15">
                      <BookOpen size={18} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-text-primary transition-colors group-hover:text-primary">{field.name}</h3>
                      <p className="mt-0.5 text-xs text-text-secondary">{field.description ?? t("fields.noDescription")}</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <StatGrid stats={statsMap.get(field.id) ?? EMPTY_STATS} />
                  </div>
                </Link>
                <div className="mr-3">
                  <RowActions field={field} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {fields?.map((field) => (
              <div key={field.id} className="card group transition-all duration-150 hover:shadow-hover">
                <Link href={`/fields/${field.id}/professors`} className="block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-card bg-primary-50 text-primary dark:bg-primary/15">
                        <BookOpen size={18} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-text-primary transition-colors group-hover:text-primary">{field.name}</h3>
                        <p className="mt-0.5 text-xs text-text-secondary">{field.description ?? t("fields.noDescription")}</p>
                      </div>
                    </div>
                    <ChevronRight size={16} className="mt-1 shrink-0 text-text-secondary" />
                  </div>
                  <div className="mt-4 border-t border-border pt-4">
                    <StatGrid stats={statsMap.get(field.id) ?? EMPTY_STATS} />
                  </div>
                </Link>
                <div className="mt-3 flex items-center justify-end border-t border-border pt-3">
                  <RowActions field={field} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {formOpen && (
        <div className="modal-overlay" onClick={() => { if (!isSaving) { setFormOpen(false); resetForm(); } }}>
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="field-form-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="field-form-title" className="mb-4 text-h4 font-bold">
              {editingField ? t("fields.editField", "Edit Field") : t("fields.newField")}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label htmlFor="field-name" className="mb-1 block text-sm font-medium">{t("fields.name")}</label>
                <input
                  id="field-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("fields.namePlaceholder")}
                  className="input"
                  autoFocus
                  required
                  disabled={isSaving}
                />
              </div>
              <div>
                <label htmlFor="field-description" className="mb-1 block text-sm font-medium">{t("fields.description")}</label>
                <textarea
                  id="field-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("fields.descriptionPlaceholder")}
                  className="input"
                  rows={2}
                  disabled={isSaving}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { setFormOpen(false); resetForm(); }}
                  disabled={isSaving}
                >
                  {t("fields.cancel")}
                </button>
                <FormButton type="submit" isLoading={isSaving} disabled={!name.trim()}>
                  {editingField ? t("fields.save", "Save") : t("fields.create")}
                </FormButton>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        entityName={t("fields.field")}
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && !deleteMutation.isPending && deleteMutation.mutate(deleteId)}
      />
    </>
  );
}
