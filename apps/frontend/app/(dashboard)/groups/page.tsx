"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ChevronRight } from "lucide-react";
import { groupsApi } from "@/lib/api/groups.api";
import { useLevels, useProfessors, useFields, useStudents } from "@/hooks/use-queries";
import type { Group, Level, Professor, Field, Student } from "@/types";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { FormButton, ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import { ViewToggle, type ViewMode } from "@/components/shared/view-toggle";
import { TreeView, buildGroupsTree } from "@/components/shared/tree-view";
import { useTranslation } from "@/lib/i18n/context";

export default function GroupsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const router = useRouter();
  const { data: levels } = useLevels();
  const { data: professors } = useProfessors();
  const { data: fields } = useFields();

  const { data: groups, isLoading } = useQuery({
    queryKey: ["groups"],
    queryFn: () => groupsApi.list(),
  });

  const { data: students } = useStudents();

  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const treeData = useMemo(
    () => buildGroupsTree(groups ?? [], levels ?? [], professors ?? [], fields ?? [], students ?? []),
    [groups, levels, professors, fields, students],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [scheduleNotes, setScheduleNotes] = useState("");
  const [levelId, setLevelId] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const levelProfMap = useMemo(() => {
    const map: Record<string, string> = {};
    levels?.forEach((l) => { map[l.id] = l.prof_id; });
    return map;
  }, [levels]);

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

  const filteredLevels = useMemo(() => {
    if (!levelId) return levels ?? [];
    return (levels ?? []).filter((l) => l.id === levelId);
  }, [levelId, levels]);

  const resetForm = () => { setName(""); setCapacity(""); setScheduleNotes(""); setLevelId(""); setEditingGroup(null); };

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
    setLevelId(group.level_id);
    setCreateOpen(true);
  };

  const openCreate = () => { resetForm(); setCreateOpen(true); };

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-h4 font-bold text-text-primary">{t("fieldsHierarchy.groupsTitle")}</h2>
            <p className="text-xs text-text-secondary mt-1">{t("fieldsHierarchy.groupsSubtitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            <ViewToggle value={viewMode} onChange={setViewMode} />
            <button className="btn btn-primary" onClick={openCreate}>
              <Plus size={16} /> {t("fieldsHierarchy.newGroup")}
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <LoadingSkeleton key={i} type="table-row" />
            ))}
          </div>
        ) : !groups?.length ? (
          <EmptyState message={t("fieldsHierarchy.noGroupsYet")} actionLabel={t("fieldsHierarchy.createGroup")} onAction={openCreate} />
        ) : viewMode === "tree" ? (
          <TreeView data={treeData} onSelect={(node) => {
            if (node.type === "field") router.push(`/fields/${node.id}/professors`);
            if (node.type === "professor") router.push(`/fields/${node.meta?.field_id}/professors/${node.id}/levels`);
            if (node.type === "level") router.push(`/fields/${node.meta?.field_id}/professors/${node.meta?.prof_id}/levels/${node.id}/groups`);
            if (node.type === "group") router.push(`/fields/${node.meta?.field_id}/professors/${node.meta?.prof_id}/levels/${node.meta?.level_id}/groups/${node.id}/students`);
          }} />
        ) : viewMode === "cards" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {groups?.map((group) => {
              const level = group.level;
              const professor = level?.professor;
              const field = professor?.field;
              return (
                <div key={group.id} className="card hover:shadow-hover transition-shadow">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-text-primary">{group.name}</h3>
                      <p className="text-sm text-text-secondary">{level?.name ?? "—"}</p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-1 text-sm">
                    <p className="text-text-secondary"><span className="font-medium">{t("students.level")}</span> {level?.name ?? "—"}</p>
                    <p className="text-text-secondary"><span className="font-medium">{t("students.professor")}</span> {professor?.full_name ?? "—"}</p>
                    <p className="text-text-secondary"><span className="font-medium">{t("fieldsHierarchy.field")}</span> {field?.name ?? "—"}</p>
                    <p className="text-text-secondary"><span className="font-medium">{t("fieldsHierarchy.capacity")}</span> {group.capacity ?? "—"}</p>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => openEdit(group)} className="btn btn-secondary text-xs flex-1">{t("fieldsHierarchy.editGroup", "Edit")}</button>
                    {field && professor && level && (
                      <Link href={`/fields/${field.id}/professors/${professor.id}/levels/${level.id}/groups/${group.id}/students`} className="btn btn-primary text-xs flex-1">{t("students.students")}</Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-table border border-border shadow-card">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.name")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.capacity")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.scheduleNotes")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("students.level")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("students.professor")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.field")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {groups?.map((group) => {
                  const level = group.level;
                  const professor = level?.professor;
                  const field = professor?.field;
                  return (
                    <tr key={group.id} className="hover:bg-background/50 transition-colors">
                      <td
                        className="px-4 py-3 font-medium text-primary hover:underline cursor-pointer"
                      >
                        <Link href={`/fields/${field?.id}/professors/${professor?.id}/levels/${level?.id}/groups/${group.id}/students`} className="hover:underline">
                          {group.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{group.capacity ?? t("fieldsHierarchy.dash")}</td>
                      <td className="px-4 py-3 text-text-secondary">{group.schedule_notes ?? t("fieldsHierarchy.dash")}</td>
                      <td className="px-4 py-3 text-text-secondary">
                        {level ? (
                          <Link href={`/fields/${professor?.field_id}/professors/${professor?.id}/levels/${level.id}`} className="text-primary hover:underline">
                            {level.name}
                          </Link>
                        ) : (
                          <span className="text-text-secondary">{t("fieldsHierarchy.dash")}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {professor ? (
                          <Link href={`/fields/${professor.field_id}/professors/${professor.id}`} className="text-primary hover:underline">
                            {professor.full_name}
                          </Link>
                        ) : (
                          <span className="text-text-secondary">{t("fieldsHierarchy.dash")}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {field ? (
                          <Link href={`/fields/${field.id}`} className="text-primary hover:underline">
                            {field.name}
                          </Link>
                        ) : (
                          <span className="text-text-secondary">{t("fieldsHierarchy.dash")}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(group)}
                            className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors"
                            aria-label={t("fieldsHierarchy.editGroup", "Edit group")}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => setDeleteId(group.id)}
                            className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-red-50 transition-colors"
                            aria-label={`${t("fieldsHierarchy.deleteGroup", "Delete group")} ${group.name}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setCreateOpen(false); resetForm(); }}>
          <div className="bg-surface rounded-modal shadow-hover p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-h4 font-bold mb-4">{editingGroup ? t("fieldsHierarchy.editGroup", "Edit Group") : t("fieldsHierarchy.newGroup")}</h3>
            <form onSubmit={(e) => { e.preventDefault(); if (name.trim() && levelId) {
              const data = { name: name.trim(), capacity: capacity ? parseInt(capacity) : undefined, schedule_notes: scheduleNotes.trim() || undefined };
              if (editingGroup) {
                updateMutation.mutate({ id: editingGroup.id, data });
              } else {
                createMutation.mutate({ level_id: levelId, ...data });
              }
            }}} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("students.selectLevel", "Select level")} *</label>
                <select value={levelId} onChange={(e) => setLevelId(e.target.value)} className="input" required disabled={!!editingGroup}>
                  <option value="">{t("students.selectLevel", "Select level")}</option>
                  {levels?.map((l) => {
                    const prof = professors?.find((p) => p.id === l.prof_id);
                    const field = prof ? fieldNameMap[prof.field_id] : "";
                    return (
                      <option key={l.id} value={l.id}>
                        {l.name} — {prof?.full_name ?? ""} {field ? `(${field})` : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.name")} *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="input" required autoFocus />
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
