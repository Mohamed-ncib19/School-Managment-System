"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, Trash2, Unlink, Loader2 } from "lucide-react";
import { hierarchyApi } from "@/lib/api/hierarchy.api";
import { useToast } from "@/components/shared/toast";
import { useTranslation } from "@/lib/i18n/context";

import { HierarchyEntity } from "@/lib/api/hierarchy-config.api";

interface HierarchyDeleteDialogProps {
  entityType: Exclude<HierarchyEntity, "student">;
  entityId: string;
  entityName: string;
  isOpen: boolean;
  onClose: () => void;
  onDone: () => void;
}

type Mode = "idle" | "confirm-archive" | "confirm-delete" | "confirm-detach" | "reassign";

export default function HierarchyDeleteDialog({ entityType, entityId, entityName, isOpen, onClose, onDone }: HierarchyDeleteDialogProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("idle");
  const [selectedChildren, setSelectedChildren] = useState<Record<string, string>>({});

  const { data: impact, isLoading: impactLoading, isError: impactError, refetch: refetchImpact } = useQuery({
    queryKey: ["hierarchy-delete-impact", entityType, entityId],
    queryFn: () => hierarchyApi.deleteImpact(entityType, entityId),
    enabled: isOpen && !!entityId,
  });

  // Sibling parents the direct children can be reassigned to (a deleted field's
  // professors move to another field of the same level, and so on).
  const { data: summary } = useQuery({
    queryKey: ["hierarchy-summary"],
    queryFn: hierarchyApi.summary,
    enabled: isOpen && !!entityId && mode === "reassign",
  });

  const siblingOptions = useMemo(() => {
    if (!summary) return [];
    if (entityType === "field") {
      const levelId = summary.fields.find((f) => f.id === entityId)?.level_id;
      return summary.fields.filter((f) => f.level_id === levelId && f.id !== entityId).map((f) => ({ id: f.id, name: f.name }));
    }
    if (entityType === "professor") {
      const fieldId = summary.professors.find((p) => p.id === entityId)?.field_id;
      return summary.professors.filter((p) => p.field_id === fieldId && p.id !== entityId).map((p) => ({ id: p.id, name: p.full_name }));
    }
    if (entityType === "group") {
      const profId = summary.groups.find((g) => g.id === entityId)?.prof_id;
      return summary.groups.filter((g) => g.prof_id === profId && g.id !== entityId).map((g) => ({ id: g.id, name: g.name }));
    }
    return [];
  }, [summary, entityType, entityId]);

  const archiveMutation = useMutation({
    mutationFn: () => hierarchyApi.archiveCascade(entityType, entityId),
    onSuccess: () => { toast.success(t("deleted.restored", "Archived")); onDone(); onClose(); },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || "Failed to archive"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => hierarchyApi.deleteCascade(entityType, entityId),
    onSuccess: () => { toast.success(t("deleted.hardDeleted", "Permanently deleted")); onDone(); onClose(); },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || "Failed to delete"),
  });

  const detachMutation = useMutation({
    mutationFn: () => hierarchyApi.detachDelete(entityType, entityId, { mode: "reassign_individual", assignments: Object.entries(selectedChildren).map(([childId, targetId]) => ({ childId, targetParentId: targetId })) }),
    onSuccess: () => { toast.success(t("deleted.restored", "Detached and archived")); onDone(); onClose(); },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || "Failed to detach"),
  });

  useEffect(() => {
    if (isOpen) {
      setMode("idle");
      setSelectedChildren({});
      refetchImpact();
    }
  }, [isOpen, entityId]);

  useEffect(() => {
    if (mode !== "reassign" || !impact) return;
    setSelectedChildren(Object.fromEntries(impact.directChildren.map((c) => [c.id, ""])));
  }, [mode, impact]);

  if (!isOpen) return null;

  const hasChildren = impact && (impact.field + impact.professor + impact.group + impact.student) > 0;
  const isLeaf = !hasChildren;

  const pickArchive = () => setMode("confirm-archive");
  const pickDelete = () => setMode("confirm-delete");
  const pickDetach = () => setMode("reassign");

  const handleArchive = () => archiveMutation.mutate();
  const handleDelete = () => deleteMutation.mutate();
  const handleDetachConfirm = () => detachMutation.mutate();

  const confirmLabel = (() => {
    switch (mode) {
      case "confirm-archive":
        return t("hierarchy.archiveCascade", "Archive everything");
      case "confirm-delete":
        return t("hierarchy.deleteCascade", "Delete permanently");
      default:
        return t("hierarchy.detachDelete", "Delete this only");
    }
  })();

  const isPending = mode === "confirm-archive" ? archiveMutation.isPending : mode === "confirm-delete" ? deleteMutation.isPending : detachMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-surface rounded-modal shadow-hover p-6 w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-h4 font-bold mb-2">{t("fieldsHierarchy.deleteEntity", "Delete")}: {entityName}</h3>

        {impactLoading && (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 size={16} className="animate-spin" /> {t("common.loading", "Loading...")}
          </div>
        )}

        {impactError && !impactLoading && (
          <div className="mb-4 p-3 rounded-lg border border-danger bg-red-50 text-sm text-danger">
            {t("hierarchy.deleteImpactError", "Could not load the impact of this deletion. Please retry.")}
          </div>
        )}

        {impact && (
          <>
            {isLeaf ? (
              <div className="space-y-3">
                <p className="text-sm text-text-secondary mb-2">{t("deleted.confirm", "This action cannot be undone.")}</p>
                <div className="space-y-2">
                  <button onClick={pickArchive} className="w-full btn btn-secondary text-left justify-start gap-2">
                    <Archive size={16} /> {t("hierarchy.archiveCascade", "Archive")}
                    <span className="text-xs text-text-secondary ml-auto">{t("hierarchy.reversible", "Reversible.")}</span>
                  </button>
                  <button onClick={pickDelete} className="w-full btn border border-danger text-danger hover:bg-red-50 text-left justify-start gap-2">
                    <Trash2 size={16} /> {t("hierarchy.deletePermanent", "Delete permanently")}
                    <span className="text-xs text-text-secondary ml-auto">{t("hierarchy.cannotUndo", "Cannot be undone.")}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-background border border-border">
                  <p className="text-sm font-medium">{t("hierarchy.deleteImpact", "Impact")}:</p>
                  <ul className="text-xs text-text-secondary mt-1 list-disc list-inside">
                    {impact.field > 0 && <li>{impact.field} {t("nav.fields", "Fields")}</li>}
                    {impact.professor > 0 && <li>{impact.professor} {t("nav.professors", "Professors")}</li>}
                    {impact.group > 0 && <li>{impact.group} {t("nav.groups", "Groups")}</li>}
                    {impact.student > 0 && <li>{impact.student} {t("students.title", "Students")}</li>}
                  </ul>
                </div>

                {mode === "idle" && (
                  <div className="space-y-2">
                    <button onClick={pickArchive} className="w-full btn btn-secondary text-left justify-start gap-2">
                      <Archive size={16} /> {t("hierarchy.archiveCascade", "Archive everything")}
                      <span className="text-xs text-text-secondary ml-auto">{t("hierarchy.archiveCascadeDesc", "Hides this item and everything under it. Reversible.")}</span>
                    </button>
                    <button onClick={pickDelete} className="w-full btn border border-danger text-danger hover:bg-red-50 text-left justify-start gap-2">
                      <Trash2 size={16} /> {t("hierarchy.deleteCascade", "Delete permanently")}
                      <span className="text-xs text-text-secondary ml-auto">{t("hierarchy.deleteCascadeDesc", "Permanently removes everything. Cannot be undone.")}</span>
                    </button>
                    <button onClick={pickDetach} className="w-full btn btn-secondary text-left justify-start gap-2">
                      <Unlink size={16} /> {t("hierarchy.detachDelete", "Delete this only")}
                      <span className="text-xs text-text-secondary ml-auto">{t("hierarchy.detachDeleteDesc", "Keep children, reassign them manually.")}</span>
                    </button>
                  </div>
                )}

                {mode === "reassign" && (
                  <div className="space-y-3">
                    <p className="text-xs text-text-secondary">{t("hierarchy.reassignDesc", "Choose where each direct child goes:")}</p>
                    <div className="max-h-60 overflow-y-auto space-y-2">
                      {impact.directChildren.map((child) => (
                        <div key={child.id} className="flex items-center gap-2">
                          <span className="text-sm flex-1 truncate">{child.name}</span>
                          <select
                            value={selectedChildren[child.id] || ""}
                            onChange={(e) => setSelectedChildren((prev) => ({ ...prev, [child.id]: e.target.value }))}
                            className="input text-xs"
                          >
                            <option value="">{t("hierarchy.leaveUnassigned", "Leave unassigned")}</option>
                            {siblingOptions.map((sibling) => (
                              <option key={sibling.id} value={sibling.id}>{sibling.name}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(mode === "confirm-archive" || mode === "confirm-delete") && (
                  <p className="text-sm text-text-secondary">
                    {mode === "confirm-archive"
                      ? t("hierarchy.confirmArchive", "This will hide this item and everything under it.")
                      : t("hierarchy.confirmDelete", "This will permanently remove this item and everything under it.")}
                  </p>
                )}
              </div>
            )}

            {(mode === "confirm-archive" || mode === "confirm-delete" || mode === "reassign") && (
              <div className="flex gap-2 justify-end pt-3 border-t border-border mt-4">
                <button type="button" className="btn btn-secondary" onClick={() => setMode("idle")} disabled={isPending}>{t("common.cancel", "Cancel")}</button>
                <button
                  type="button"
                  className="btn btn-danger disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => (mode === "confirm-archive" ? handleArchive() : mode === "confirm-delete" ? handleDelete() : handleDetachConfirm())}
                  disabled={isPending}
                >
                  {isPending ? (
                    <>
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" /> {t("common.working", "Working...")}
                    </>
                  ) : (
                    confirmLabel
                  )}
                </button>
              </div>
            )}
          </>
        )}

        {mode === "idle" && impact && !impactLoading && (
          <div className="flex gap-3 justify-end pt-4 mt-4 border-t border-border">
            <button className="btn btn-secondary" onClick={onClose}>{t("common.cancel", "Cancel")}</button>
          </div>
        )}
      </div>
    </div>
  );
}
