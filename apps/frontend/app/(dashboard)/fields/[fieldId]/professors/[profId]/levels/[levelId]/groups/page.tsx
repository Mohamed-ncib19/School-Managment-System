"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Pencil, Trash2, ChevronRight } from "lucide-react";
import { groupsApi } from "@/lib/api/groups.api";
import { useFields, useProfessors, useLevels } from "@/hooks/use-queries";
import type { Group } from "@/types";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { FormButton, ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import { useTranslation } from "@/lib/i18n/context";

export default function LevelGroupsPage() {
  const { t } = useTranslation();
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const fieldId = params.fieldId as string;
  const profId = params.profId as string;
  const levelId = params.levelId as string;

  const { data: groups, isLoading } = useQuery({
    queryKey: ["groups", levelId],
    queryFn: () => groupsApi.list(levelId),
  });

  const { data: fields } = useFields();
  const { data: professors } = useProfessors(fieldId);
  const { data: levels } = useLevels(profId);
  const field = fields?.find((f) => f.id === fieldId);
  const prof = professors?.find((p) => p.id === profId);
  const level = levels?.find((l) => l.id === levelId);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [scheduleNotes, setScheduleNotes] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const resetForm = () => { setName(""); setCapacity(""); setScheduleNotes(""); setEditingGroup(null); };

  const createMutation = useMutation({
    mutationFn: (data: { level_id: string; name: string; capacity?: number; schedule_notes?: string }) => groupsApi.create(data),
    onSuccess: () => { qc.invalidateQueries(); setCreateOpen(false); resetForm(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; capacity?: number; schedule_notes?: string } }) => groupsApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries(); setCreateOpen(false); resetForm(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => groupsApi.delete(id),
    onSuccess: () => { qc.invalidateQueries(); setDeleteId(null); },
  });

  const openEdit = (group: Group) => {
    setEditingGroup(group);
    setName(group.name);
    setCapacity(group.capacity?.toString() ?? "");
    setScheduleNotes(group.schedule_notes ?? "");
    setCreateOpen(true);
  };

  const openCreate = () => { resetForm(); setCreateOpen(true); };

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
          <span className="text-text-primary font-medium">{t("fieldsHierarchy.breadcrumbGroups")}</span>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="h-9 w-9 flex items-center justify-center rounded-btn hover:bg-neutral-soft" aria-label={t("fieldsHierarchy.goBack")}>
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
             <h2 className="text-h4 font-bold text-text-primary">{level?.name ?? t("fieldsHierarchy.groupsTitle")}</h2>
             <p className="text-xs text-text-secondary">{t("fieldsHierarchy.groupsSubtitle")}</p>
          </div>
          <button className="btn btn-primary" onClick={openCreate}>
            <Plus size={16} /> {t("fieldsHierarchy.newGroup")}
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <LoadingSkeleton key={i} type="table-row" />
            ))}
          </div>
        ) : !groups?.length ? (
          <EmptyState message={t("fieldsHierarchy.noGroupsYet")} actionLabel={t("fieldsHierarchy.createGroup")} onAction={openCreate} />
        ) : (
          <div className="overflow-hidden rounded-table border border-border shadow-card">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.name")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.capacity")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.scheduleNotes")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {groups?.map((group) => (
                  <tr key={group.id} className="hover:bg-background/50 transition-colors">
                    <td
                      className="px-4 py-3 font-medium text-primary hover:underline cursor-pointer"
                      onClick={() => router.push(`/fields/${fieldId}/professors/${profId}/levels/${levelId}/groups/${group.id}/students`)}
                    >
                      {group.name}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{group.capacity ?? t("fieldsHierarchy.dash")}</td>
                    <td className="px-4 py-3 text-text-secondary">{group.schedule_notes ?? t("fieldsHierarchy.dash")}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); openEdit(group); }}
                          className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors"
                          aria-label={t("fieldsHierarchy.editGroup", "Edit group")}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteId(group.id); }}
                          className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-red-50 transition-colors"
                          aria-label={`${t("fieldsHierarchy.deleteGroup", "Delete group")} ${group.name}`}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setCreateOpen(false); resetForm(); }}>
          <div className="bg-surface rounded-modal shadow-hover p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-h4 font-bold mb-4">{editingGroup ? t("fieldsHierarchy.editGroup", "Edit Group") : t("fieldsHierarchy.newGroup")}</h3>
            <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) {
              const data = { name: name.trim(), capacity: capacity ? parseInt(capacity) : undefined, schedule_notes: scheduleNotes.trim() || undefined };
              if (editingGroup) {
                updateMutation.mutate({ id: editingGroup.id, data });
              } else {
                createMutation.mutate({ level_id: levelId, ...data });
              }
            }}} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.name")}</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="input" autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.capacity")}</label>
                <input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.scheduleNotes")}</label>
                <textarea value={scheduleNotes} onChange={(e) => setScheduleNotes(e.target.value)} className="input" rows={2} />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" className="btn btn-secondary" onClick={() => { setCreateOpen(false); resetForm(); }}>{t("fieldsHierarchy.cancel")}</button>
                <FormButton type="submit" isLoading={createMutation.isPending || updateMutation.isPending}>{editingGroup ? t("fieldsHierarchy.save", "Save") : t("fieldsHierarchy.create")}</FormButton>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        entityName={t("fieldsHierarchy.entityName")}
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
      />
    </>
  );
}
