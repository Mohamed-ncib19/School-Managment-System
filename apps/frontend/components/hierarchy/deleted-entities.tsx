"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Trash2, X, CheckSquare, Square } from "lucide-react";
import { levelsApi } from "@/lib/api/levels.api";
import { fieldsApi } from "@/lib/api/fields.api";
import { professorsApi } from "@/lib/api/professors.api";
import { groupsApi } from "@/lib/api/groups.api";
import { studentsApi } from "@/lib/api/students.api";
import { useTranslation } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { describeError } from "@/components/shared/error-state";
import { ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import type { HierarchyEntity } from "@/lib/api/hierarchy-config.api";
import { formatDate } from "@/lib/utils/format";

interface DeletedEntitiesProps {
  entityType: HierarchyEntity;
  parentId?: string;
  isOpen: boolean;
  onClose: () => void;
}

const entityListKey = (entityType: HierarchyEntity) =>
  entityType === "professor" ? "professors" : entityType + "s";

const deletedListKey = (entityType: HierarchyEntity, parentId?: string) => [
  "deleted-entities",
  entityType,
  parentId ?? "all",
];

const labelOf = (entityType: HierarchyEntity, item: any): string =>
  entityType === "professor" ? item.full_name : `${item.first_name ?? ""} ${item.last_name ?? ""}`.trim() || item.name;

/**
 * The "Deleted" space: archived hierarchy items with one-click restore, or a
 * permanent purge (single or bulk) that removes the item and everything
 * beneath it. Only archived rows can be purged — the backend refuses live ones.
 */
export default function DeletedEntities({ entityType, parentId, isOpen, onClose }: DeletedEntitiesProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hardDeleteTarget, setHardDeleteTarget] = useState<"bulk" | string | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const { data: items, isLoading } = useQuery({
    queryKey: deletedListKey(entityType, parentId),
    enabled: isOpen,
    queryFn: async () => {
      switch (entityType) {
        case "level": return levelsApi.deleted();
        case "field": return fieldsApi.deleted(parentId);
        case "professor": return professorsApi.deleted(parentId);
        case "group": return groupsApi.deleted(parentId);
        case "student": return studentsApi.deleted(parentId);
        default: return [];
      }
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: [entityListKey(entityType)] });
    qc.invalidateQueries({ queryKey: deletedListKey(entityType, parentId) });
    qc.invalidateQueries({ queryKey: ["hierarchy-summary"] });
  };

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      switch (entityType) {
        case "level": return levelsApi.restore(id);
        case "field": return fieldsApi.restore(id);
        case "professor": return professorsApi.restore(id);
        case "group": return groupsApi.restore(id);
        case "student": return studentsApi.restore(id);
        default: throw new Error("Unknown entity type");
      }
    },
    onSuccess: () => {
      refresh();
      toast.success(t("deleted.restored", "Restored"));
    },
    onError: (err) => {
      const { title, detail } = describeError(err);
      toast.error(title, detail);
    },
  });

  const hardDeleteMutation = useMutation({
    mutationFn: async (target: "bulk" | string) => {
      const ids = target === "bulk" ? Array.from(selected) : [target];
      const results = await Promise.all(
        ids.map((id) => {
          switch (entityType) {
            case "level": return levelsApi.hardDelete(id);
            case "field": return fieldsApi.hardDelete(id);
            case "professor": return professorsApi.hardDelete(id);
            case "group": return groupsApi.hardDelete(id);
            default: return Promise.resolve(null);
          }
        }),
      );
      return { count: results.length };
    },
    onSuccess: (result) => {
      refresh();
      setSelected(new Set());
      setHardDeleteTarget(null);
      toast.success(
        t("deleted.hardDeleted", "Permanently deleted"),
        t("deleted.hardDeletedDetail", `${result.count} item(s) removed with their history.`),
      );
    },
    onError: (err) => {
      const { title, detail } = describeError(err);
      toast.error(title, detail);
      setHardDeleteTarget(null);
    },
  });

  useEffect(() => {
    if (!isOpen) {
      setSelected(new Set());
      setHardDeleteTarget(null);
    }
  }, [isOpen]);

  // Indeterminate checkbox for a partial selection.
  useEffect(() => {
    if (selectAllRef.current) {
      const total = items?.length ?? 0;
      selectAllRef.current.indeterminate = selected.size > 0 && selected.size < total;
    }
  }, [selected, items]);

  if (!isOpen) return null;

  const total = items?.length ?? 0;
  const allSelected = total > 0 && selected.size === total;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set((items ?? []).map((i: any) => i.id)));
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hardDeleteNames =
    hardDeleteTarget === "bulk"
      ? `${selected.size} ${t("deleted.items", "items")}`
      : labelOf(entityType, (items ?? []).find((i: any) => i.id === hardDeleteTarget) ?? {});

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => !restoreMutation.isPending && !hardDeleteMutation.isPending && onClose()}
    >
      <div
        className="mx-4 flex max-h-[85vh] w-full max-w-md flex-col rounded-modal bg-surface p-6 shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-h4 flex items-center gap-2 font-bold text-text-primary">
              <Trash2 size={18} className="text-danger" />
              {t("deleted.title", "Deleted")} {t(`hierarchy.${entityType}`, entityType)}
            </h3>
            <p className="mt-1 text-xs text-text-secondary">{t("deleted.subtitle", "Archived items can be restored at any time.")}</p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-btn text-text-secondary hover:bg-neutral-soft"
            aria-label={t("common.close", "Close")}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-btn bg-neutral-soft" />
              ))}
            </div>
          ) : !items?.length ? (
            <p className="py-10 text-center text-sm text-text-secondary">
              {t("deleted.empty", "Nothing deleted yet.")}
            </p>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2 rounded-btn bg-neutral-soft px-3 py-2">
                <label className="flex flex-1 cursor-pointer items-center gap-2 text-xs font-medium text-text-secondary">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 accent-primary"
                  />
                  {allSelected ? t("deleted.deselectAll", "Deselect all") : t("deleted.selectAll", "Select all")}
                </label>
                <span className="text-xs text-text-secondary">
                  {selected.size > 0 && `${selected.size}/${total}`}
                </span>
              </div>

              <ul className="space-y-2">
                {items.map((item: any) => {
                  const checked = selected.has(item.id);
                  return (
                    <li
                      key={item.id}
                      className={`flex items-center gap-2 rounded-btn border p-3 transition-colors ${
                        checked ? "border-primary/50 bg-primary-50/50 dark:bg-primary/10" : "border-border"
                      }`}
                    >
                      <button
                        onClick={() => toggleOne(item.id)}
                        className="shrink-0 text-text-secondary transition-colors hover:text-primary"
                        aria-label={checked ? t("deleted.deselect", "Deselect") : t("deleted.select", "Select")}
                      >
                        {checked ? <CheckSquare size={18} className="text-primary" /> : <Square size={18} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text-primary">{labelOf(entityType, item)}</p>
                        <p className="text-xs text-text-secondary">
                          {t("deleted.deletedOn", "Deleted")}: {formatDate(item.created_at)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          onClick={() => restoreMutation.mutate(item.id)}
                          disabled={restoreMutation.isPending || hardDeleteMutation.isPending}
                          className="btn btn-secondary px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <RotateCcw size={13} className="inline-block" /> {t("deleted.restore", "Restore")}
                        </button>
                        <button
                          onClick={() => setHardDeleteTarget(item.id)}
                          disabled={restoreMutation.isPending || hardDeleteMutation.isPending}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-btn text-text-secondary transition-colors hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-danger/10"
                          aria-label={`${t("deleted.hardDelete", "Hard delete")} ${labelOf(entityType, item)}`}
                          title={t("deleted.hardDelete", "Hard delete")}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {selected.size > 0 && (
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs font-medium text-text-secondary">
              {selected.size} {t("deleted.selected", "selected")}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => setSelected(new Set())} className="btn btn-secondary px-3 py-1.5 text-xs">
                {t("deleted.clearSelection", "Clear")}
              </button>
              <button
                onClick={() => setHardDeleteTarget("bulk")}
                disabled={hardDeleteMutation.isPending}
                className="btn btn-danger px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 size={13} className="inline-block" /> {t("deleted.hardDeleteSelected", "Hard delete selected")}
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDeleteDialog
        entityName={t("deleted.hardDelete", "Hard delete")}
        isOpen={!!hardDeleteTarget}
        isDeleting={hardDeleteMutation.isPending}
        onClose={() => setHardDeleteTarget(null)}
        onConfirm={() => hardDeleteTarget && hardDeleteMutation.mutate(hardDeleteTarget)}
        message={`${t("deleted.hardDeleteConfirm", "This permanently removes")} ${hardDeleteNames} ${t(
          "deleted.hardDeleteScope",
          "and everything beneath it, including students and payment history. This cannot be undone.",
        )}\n\n${t("deleted.hardDeleteBackupNote", "Restoring from a database backup will bring this data back.")}`}
      />
    </div>
  );
}
