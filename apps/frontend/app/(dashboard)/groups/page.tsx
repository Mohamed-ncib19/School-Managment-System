"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ChevronRight, Printer, Search } from "lucide-react";
import { groupsApi } from "@/lib/api/groups.api";
import { useProfessors, useFields, useLevels } from "@/hooks/use-queries";
import { useViewMode } from "@/hooks/use-view-mode";
import { useTimeSlots, useClassrooms } from "@/hooks/use-scheduling";
import type { Group, Professor, Field, TileDto } from "@/types";
import { TableSkeleton, PageLoader } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/empty-state";
import { FormButton, ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import DeletedEntities from "@/components/hierarchy/deleted-entities";
import { ViewToggle } from "@/components/shared/view-toggle";
import { WeeklyScheduleBuilder } from "@/components/scheduling/weekly-schedule-builder";
import { useTranslation } from "@/lib/i18n/context";

export default function GroupsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const router = useRouter();
  const { data: professors } = useProfessors();
  const { data: fields } = useFields();
  const { data: levels } = useLevels();

  const { data: groups, isLoading } = useQuery({
    queryKey: ["groups"],
    queryFn: () => groupsApi.list(),
  });

  const { viewMode, setViewMode } = useViewMode("list");

  const [createOpen, setCreateOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [profId, setProfId] = useState("");
  const [tiles, setTiles] = useState<TileDto[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const { data: timeSlots } = useTimeSlots();
  const { data: classrooms } = useClassrooms();

  // Filters
  const [search, setSearch] = useState("");
  const [filterLevelId, setFilterLevelId] = useState("");
  const [filterFieldId, setFilterFieldId] = useState("");
  const [filterProfId, setFilterProfId] = useState("");

  const filteredGroups = useMemo(() => {
    if (!groups) return [];
    return groups.filter((group) => {
      if (search) {
        const q = search.toLowerCase();
        const matchName = group.name.toLowerCase().includes(q);
        const matchProf = group.professor?.full_name?.toLowerCase().includes(q);
        if (!matchName && !matchProf) return false;
      }
      if (filterLevelId && group.professor?.field?.level_id !== filterLevelId) return false;
      if (filterFieldId && group.professor?.field_id !== filterFieldId) return false;
      if (filterProfId && group.prof_id !== filterProfId) return false;
      return true;
    });
  }, [groups, search, filterLevelId, filterFieldId, filterProfId]);

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

  const resetForm = () => { setName(""); setCapacity(""); setProfId(""); setTiles([]); setEditingGroup(null); };

  const createMutation = useMutation({
    mutationFn: (data: { prof_id: string; name: string; capacity?: number; scheduleTiles?: TileDto[] }) => groupsApi.create(data),
    onSuccess: () => { qc.invalidateQueries(); setCreateOpen(false); resetForm(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; capacity?: number; scheduleTiles?: TileDto[] } }) => groupsApi.update(id, data),
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
    setProfId(group.professor?.id ?? "");
    setTiles([]);
    setCreateOpen(true);
  };

  const openCreate = () => { resetForm(); setCreateOpen(true); };

  const getFieldForGroup = (group: Group): Field | undefined => {
    const prof = group.professor;
    if (!prof) return undefined;
    return fields?.find((f) => f.id === prof.field_id);
  };

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
            <button className="btn btn-secondary" onClick={() => setDeletedOpen(true)} title={t("deleted.title", "Deleted")}>
              <Trash2 size={16} /> {t("deleted.title", "Deleted")}
            </button>
            <button className="btn btn-primary" onClick={openCreate}>
              <Plus size={16} /> {t("fieldsHierarchy.newGroup")}
            </button>
          </div>
        </div>

        {isLoading ? (
          <PageLoader text={t("common.loading", "Loading…")} />
        ) : !groups?.length ? (
          <EmptyState message={t("fieldsHierarchy.noGroupsYet")} actionLabel={t("fieldsHierarchy.createGroup")} onAction={openCreate} />
        ) : (
          <>
            <div className="card">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
                  <input
                    type="text"
                    placeholder={t("fieldsHierarchy.searchGroups", "Search by group or professor name…")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="input pl-9 w-full text-xs"
                  />
                </div>
                <select
                  aria-label={t("nav.levels", "Levels")}
                  value={filterLevelId}
                  onChange={(e) => { setFilterLevelId(e.target.value); setFilterFieldId(""); setFilterProfId(""); }}
                  className="input w-auto min-w-[130px] text-xs"
                >
                  <option value="">{t("students.allLevels", "All levels")}</option>
                  {levels?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <select
                  aria-label={t("nav.fields", "Fields")}
                  value={filterFieldId}
                  onChange={(e) => { setFilterFieldId(e.target.value); setFilterProfId(""); }}
                  className="input w-auto min-w-[130px] text-xs"
                >
                  <option value="">{t("students.allFields", "All fields")}</option>
                  {fields?.filter((f) => !filterLevelId || f.level_id === filterLevelId).map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
                <select
                  aria-label={t("nav.professors", "Professors")}
                  value={filterProfId}
                  onChange={(e) => setFilterProfId(e.target.value)}
                  className="input w-auto min-w-[140px] text-xs"
                >
                  <option value="">{t("students.allProfessors", "All professors")}</option>
                  {professors?.filter((p) => !filterFieldId || p.field_id === filterFieldId).map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name}</option>
                  ))}
                </select>
              </div>
            </div>

            {viewMode === "cards" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredGroups.map((group) => {
                  const prof = group.professor;
                  const field = prof ? fields?.find((f) => f.id === prof.field_id) : undefined;
                  const lvlId = prof?.field?.level?.id;
                  const studentsHref =
                    prof && field && lvlId
                      ? `/hierarchy/field/${field.id}/professor/${prof.id}/level/${lvlId}/group/${group.id}`
                      : null;
                  return (
                    <div
                      key={group.id}
                      className="card group cursor-pointer hover:shadow-hover transition-shadow"
                      onClick={() => studentsHref && router.push(studentsHref)}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold text-text-primary transition-colors group-hover:text-primary">{group.name}</h3>
                          <p className="text-sm text-text-secondary">{prof?.full_name ?? "—"}</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteId(group.id); }}
                          className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-red-50 transition-colors"
                          aria-label={`${t("fieldsHierarchy.deleteGroup", "Delete group")} ${group.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="mt-3 space-y-1 text-sm">
                        <div className="flex items-center gap-1 text-xs text-text-secondary flex-wrap">
                          <span className="font-medium text-text-primary">{field?.level?.name ?? "—"}</span>
                          <ChevronRight size={10} className="text-text-secondary/50 shrink-0" />
                          <span>{field?.name ?? "—"}</span>
                          <ChevronRight size={10} className="text-text-secondary/50 shrink-0" />
                          <span>{prof?.full_name ?? "—"}</span>
                        </div>
                        <p className="text-text-secondary"><span className="font-medium">{t("fieldsHierarchy.capacity")}</span> {group.capacity ?? "—"}</p>
                      </div>
                      <div className="mt-4 flex gap-2">
                        <button onClick={(e) => { e.stopPropagation(); openEdit(group); }} className="btn btn-secondary text-xs flex-1">{t("fieldsHierarchy.editGroup", "Edit")}</button>
                        {prof && field && (
                          <Link href={`/hierarchy/field/${field.id}/professor/${prof.id}`} onClick={(e) => e.stopPropagation()} className="btn btn-primary text-xs flex-1 text-center">{t("fieldsHierarchy.viewLevels")}</Link>
                        )}
                        {prof && field && lvlId && (
                          <Link
                            href={`/attendance-sheet/${group.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="btn btn-primary text-xs px-2"
                            title={t("fieldsHierarchy.attendanceSheet", "Attendance")}
                          >
                            <Printer size={14} />
                          </Link>
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
                      <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.hierarchy", "Hierarchy")}</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredGroups.map((group) => {
                      const prof = group.professor;
                      const field = prof?.field;
                      return (
                        <tr key={group.id} className="hover:bg-background/50 transition-colors">
                          <td className="px-4 py-3 font-medium text-primary hover:underline cursor-pointer">
                            <Link href={prof && field ? `/hierarchy/field/${field.id}/professor/${prof.id}` : "#"} className="hover:underline">
                              {group.name}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-text-secondary">{group.capacity ?? t("fieldsHierarchy.dash")}</td>
                          <td className="px-4 py-3 text-text-secondary">{group.schedule_notes ?? t("fieldsHierarchy.dash")}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 text-xs text-text-secondary flex-wrap">
                              <span className="font-medium text-text-primary">{field?.level?.name ?? "—"}</span>
                              <ChevronRight size={10} className="text-text-secondary/50 shrink-0" />
                              <span>{field?.name ?? "—"}</span>
                              <ChevronRight size={10} className="text-text-secondary/50 shrink-0" />
                              <span>{prof?.full_name ?? "—"}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {prof && field && prof.field?.level?.id && (
                                <Link href={`/attendance-sheet/${group.id}`} className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors" aria-label="Générer la feuille de présence" title="Générer la feuille de présence mensuelle">
                                  <Printer size={14} />
                                </Link>
                              )}
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
          </>
        )}
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setCreateOpen(false); resetForm(); }}>
          <div className="bg-surface rounded-modal shadow-hover p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-h4 font-bold mb-4">{editingGroup ? t("fieldsHierarchy.editGroup", "Edit Group") : t("fieldsHierarchy.newGroup")}</h3>
            <form onSubmit={(e) => { e.preventDefault(); if (name.trim() && profId) {
              if (editingGroup) {
                updateMutation.mutate({ id: editingGroup.id, data: { name: name.trim(), capacity: capacity ? parseInt(capacity) : undefined, scheduleTiles: tiles.length ? tiles : undefined } });
              } else {
                createMutation.mutate({ prof_id: profId, name: name.trim(), capacity: capacity ? parseInt(capacity) : undefined, scheduleTiles: tiles.length ? tiles : undefined });
              }
            }}} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("students.selectProfessor", "Select professor")} *</label>
                <select value={profId} onChange={(e) => setProfId(e.target.value)} className="input" required disabled={!!editingGroup}>
                  <option value="">{t("students.selectProfessor", "Select professor")}</option>
                  {professors?.map((p) => <option key={p.id} value={p.id}>{p.full_name} — {fieldNameMap[p.field_id] ?? ""}</option>)}
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
                <label className="block text-sm font-medium mb-1">{t("scheduling.schedule", "Schedule")}</label>
                <WeeklyScheduleBuilder
                  groupId={editingGroup?.id}
                  profId={profId || null}
                  initialTiles={[]}
                  onChange={setTiles}
                />
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
        message={t("deleted.confirm", "It will be archived and can be restored later.")}
      />

      <DeletedEntities entityType="group" isOpen={deletedOpen} onClose={() => setDeletedOpen(false)} />
    </>
  );
}
