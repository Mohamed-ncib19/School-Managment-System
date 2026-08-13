"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, ChevronDown, ChevronUp, CalendarDays, AlertTriangle, ShieldCheck } from "lucide-react";
import { schedulingApi } from "@/lib/api/scheduling.api";
import { useProfessors, useGroups } from "@/hooks/use-queries";
import { useClassrooms, useTimeSlots, useConflicts } from "@/hooks/use-scheduling";
import type { ScheduleEntry, Professor, Group, Classroom, TimeSlot, Conflict } from "@/types";
import { TableSkeleton, PageLoader } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/empty-state";
import { FormButton, ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import { useTranslation } from "@/lib/i18n/context";

const DAY_NAMES = ["Sam", "Dim", "Lun", "Mar", "Mer", "Jeu", "Ven"];

const CONFLICT_META: Record<string, { label: string; hint: string }> = {
  classroom: { label: "Salle", hint: "Deux cours dans la même salle au même moment." },
  professor: { label: "Professeur", hint: "Le professeur est attendu à deux endroits." },
  student: { label: "Étudiant", hint: "L'étudiant a deux cours en même temps." },
};

/**
 * Timetable clashes across every live rule.
 *
 * The system has always detected these — every save is checked — but nothing
 * ever showed them afterwards, so a conflict accepted on Monday was invisible
 * by Tuesday. This reads the same scan the save path uses, grouped by what is
 * double-booked, and stays out of the way entirely when the timetable is clean.
 */
function ConflictsPanel() {
  const { t } = useTranslation();
  const { data: conflicts, isLoading } = useConflicts();
  const [open, setOpen] = useState(false);

  const byType = useMemo(() => {
    const map = new Map<string, Conflict[]>();
    for (const c of conflicts ?? []) {
      const list = map.get(c.type) ?? [];
      list.push(c);
      map.set(c.type, list);
    }
    return map;
  }, [conflicts]);

  if (isLoading || !conflicts) return null;

  if (conflicts.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-btn border border-success/30 bg-success-soft px-3 py-2">
        <ShieldCheck size={15} className="text-success shrink-0" aria-hidden="true" />
        <p className="text-xs text-success-700">
          {t("scheduling.noConflicts", "Aucun conflit dans l'emploi du temps.")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-gold/40 bg-gold-50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gold-100/60 transition-colors"
      >
        <AlertTriangle size={15} className="text-gold-500 shrink-0" aria-hidden="true" />
        <p className="text-xs text-gold-700 font-medium">
          {conflicts.length} {t("scheduling.conflictsDetected", "conflit(s) détecté(s)")}
        </p>
        <span className="ml-2 flex items-center gap-1.5">
          {Array.from(byType.entries()).map(([type, list]: [string, Conflict[]]) => (
            <span
              key={type}
              className="inline-flex items-center gap-1 rounded-full bg-white/70 border border-gold/30 px-2 py-0.5 text-[10px] font-semibold text-gold-700"
            >
              {CONFLICT_META[type]?.label ?? type} {list.length}
            </span>
          ))}
        </span>
        <ChevronDown
          size={14}
          className={`ml-auto text-gold-600 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="border-t border-gold/30 bg-white/50 divide-y divide-gold/20 max-h-64 overflow-y-auto">
          {Array.from(byType.entries()).map(([type, list]: [string, Conflict[]]) => (
            <div key={type} className="px-3 py-2">
              <p className="text-[11px] font-semibold text-gold-700 mb-1">
                {CONFLICT_META[type]?.label ?? type}
                <span className="font-normal text-text-secondary"> — {CONFLICT_META[type]?.hint ?? ""}</span>
              </p>
              <ul className="space-y-0.5">
                {list.map((c: Conflict, i: number) => (
                  <li key={i} className="text-xs text-text-secondary">
                    <span className="font-medium text-text-primary">{c.entityName}</span>
                    {c.timeSlotLabel ? ` · ${c.timeSlotLabel}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ScheduleEntriesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data: entries, isLoading } = useQuery({
    queryKey: ["scheduling", "entries"],
    queryFn: () => schedulingApi.entries.list({ active: true }),
  });

  const { data: professors } = useProfessors();
  const { data: groups } = useGroups();
  const { data: classrooms } = useClassrooms();
  const { data: timeSlots } = useTimeSlots();

  const [search, setSearch] = useState("");
  const [filterGroupId, setFilterGroupId] = useState("");
  const [filterProfId, setFilterProfId] = useState("");
  const [filterClassroomId, setFilterClassroomId] = useState("");
  const [filterTimeSlotId, setFilterTimeSlotId] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ScheduleEntry | null>(null);
  const [formGroupId, setFormGroupId] = useState("");
  const [formTimeSlotId, setFormTimeSlotId] = useState("");
  const [formClassroomId, setFormClassroomId] = useState("");
  const [formProfId, setFormProfId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveUntil, setEffectiveUntil] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filteredEntries = useMemo(() => {
    if (!entries) return [];
    const q = search.toLowerCase();
    return entries.filter((e) => {
      if (q) {
        const hay = `${e.group?.name ?? ""} ${e.professor?.full_name ?? ""} ${e.time_slot?.label ?? ""} ${e.classroom?.name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterGroupId && e.group_id !== filterGroupId) return false;
      if (filterProfId && e.prof_id !== filterProfId) return false;
      if (filterClassroomId && e.classroom_id !== filterClassroomId) return false;
      if (filterTimeSlotId && e.time_slot_id !== filterTimeSlotId) return false;
      return true;
    });
  }, [entries, search, filterGroupId, filterProfId, filterClassroomId, filterTimeSlotId]);

  const resetForm = () => {
    setFormGroupId("");
    setFormTimeSlotId("");
    setFormClassroomId("");
    setFormProfId("");
    setEffectiveFrom("");
    setEffectiveUntil("");
    setEditingEntry(null);
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => schedulingApi.entries.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduling"] });
      setCreateOpen(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => schedulingApi.entries.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduling"] });
      setCreateOpen(false);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => schedulingApi.entries.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduling"] });
      setDeleteId(null);
    },
  });

  const openEdit = (entry: ScheduleEntry) => {
    setEditingEntry(entry);
    setFormGroupId(entry.group_id);
    setFormTimeSlotId(entry.time_slot_id);
    setFormClassroomId(entry.classroom_id ?? "");
    setFormProfId(entry.prof_id);
    setEffectiveFrom(entry.effective_from.split("T")[0]);
    setEffectiveUntil(entry.effective_until ? entry.effective_until.split("T")[0] : "");
    setCreateOpen(true);
  };

  const openCreate = () => {
    resetForm();
    setEffectiveFrom(new Date().toISOString().split("T")[0]);
    setCreateOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formGroupId || !formTimeSlotId || !formProfId || !effectiveFrom) return;
    const data = {
      group_id: formGroupId,
      time_slot_id: formTimeSlotId,
      classroom_id: formClassroomId || null,
      prof_id: formProfId,
      effective_from: effectiveFrom,
      effective_until: effectiveUntil || null,
    };
    if (editingEntry) {
      updateMutation.mutate({ id: editingEntry.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const selectedGroup = groups?.find((g) => g.id === formGroupId);

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-h4 font-bold text-text-primary">{t("nav.scheduleEntries", "Schedule")}</h2>
            <p className="text-xs text-text-secondary mt-1">{t("scheduling.entriesSubtitle", "Manage schedule sessions")}</p>
          </div>
          <button className="btn btn-primary" onClick={openCreate}>
            <Plus size={16} /> {t("common.add", "Add")}
          </button>
        </div>

        <ConflictsPanel />

        <div className="card">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
              <input
                type="text"
                placeholder={t("common.search", "Search...")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input pl-9 w-full text-xs"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className="btn btn-secondary text-xs"
            >
              {t("common.filters", "Filters")} {showFilters ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
          {showFilters && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
              <div>
                <label className="block text-xs font-medium mb-1">{t("fieldsHierarchy.group", "Group")}</label>
                <select value={filterGroupId} onChange={(e) => setFilterGroupId(e.target.value)} className="input text-xs">
                  <option value="">{t("common.all", "All")}</option>
                  {groups?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t("fieldsHierarchy.professor", "Professor")}</label>
                <select value={filterProfId} onChange={(e) => setFilterProfId(e.target.value)} className="input text-xs">
                  <option value="">{t("common.all", "All")}</option>
                  {professors?.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t("nav.classrooms", "Classroom")}</label>
                <select value={filterClassroomId} onChange={(e) => setFilterClassroomId(e.target.value)} className="input text-xs">
                  <option value="">{t("common.all", "All")}</option>
                  {classrooms?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t("nav.timeSlots", "Time slot")}</label>
                <select value={filterTimeSlotId} onChange={(e) => setFilterTimeSlotId(e.target.value)} className="input text-xs">
                  <option value="">{t("common.all", "All")}</option>
                  {timeSlots?.map((ts) => (
                    <option key={ts.id} value={ts.id}>{DAY_NAMES[ts.day_of_week]} {ts.start_time}-{ts.end_time}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {isLoading ? (
          <PageLoader text={t("common.loading", "Loading...")} />
        ) : !filteredEntries.length ? (
          <EmptyState message={t("scheduling.noEntries", "No schedule entries yet")} actionLabel={t("scheduling.addEntry", "Add entry")} onAction={openCreate} />
        ) : (
          <div className="overflow-hidden rounded-table border border-border shadow-card">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.group", "Group")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("fieldsHierarchy.professor", "Professor")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("nav.classrooms", "Classroom")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("nav.timeSlots", "Time slot")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("scheduling.from", "From")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("scheduling.until", "Until")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase">{t("common.actions", "Actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-background/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-primary">{entry.group?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-text-secondary">{entry.professor?.full_name ?? "—"}</td>
                    <td className="px-4 py-3 text-text-secondary">{entry.classroom?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-text-secondary">{entry.time_slot ? `${DAY_NAMES[entry.time_slot.day_of_week]} ${entry.time_slot.start_time}-${entry.time_slot.end_time}` : "—"}</td>
                    <td className="px-4 py-3 text-text-secondary">{entry.effective_from.split("T")[0]}</td>
                    <td className="px-4 py-3 text-text-secondary">{entry.effective_until ? entry.effective_until.split("T")[0] : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/schedule/calendar?groupId=${entry.group_id}`}
                          className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors"
                          aria-label={t("scheduling.viewOnCalendar", "View on calendar")}
                          title={t("scheduling.viewOnCalendar", "View on calendar")}
                        >
                          <CalendarDays size={14} />
                        </Link>
                        <button onClick={() => openEdit(entry)} className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary hover:bg-primary-50 transition-colors" aria-label={t("common.edit", "Edit")}>
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setDeleteId(entry.id)} className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-red-50 transition-colors" aria-label={t("common.delete", "Delete")}>
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
            <h3 className="text-h4 font-bold mb-4">{editingEntry ? t("scheduling.editEntry", "Edit Schedule Entry") : t("scheduling.newEntry", "New Schedule Entry")}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.group", "Group")} *</label>
                <select value={formGroupId} onChange={(e) => setFormGroupId(e.target.value)} className="input" required>
                  <option value="">{t("students.selectGroup", "Select group")}</option>
                  {groups?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.professor", "Professor")} *</label>
                <select value={formProfId} onChange={(e) => setFormProfId(e.target.value)} className="input" required>
                  <option value="">{t("students.selectProfessor", "Select professor")}</option>
                  {professors?.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("nav.timeSlots", "Time slot")} *</label>
                <select value={formTimeSlotId} onChange={(e) => setFormTimeSlotId(e.target.value)} className="input" required>
                  <option value="">{t("scheduling.selectTimeSlot", "Select time slot")}</option>
                  {timeSlots?.map((ts) => (
                    <option key={ts.id} value={ts.id}>{DAY_NAMES[ts.day_of_week]} {ts.start_time}-{ts.end_time}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("nav.classrooms", "Classroom")}</label>
                <select value={formClassroomId} onChange={(e) => setFormClassroomId(e.target.value)} className="input">
                  <option value="">{t("scheduling.noClassroom", "No classroom")}</option>
                  {classrooms?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("scheduling.from", "From")} *</label>
                <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="input" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("scheduling.until", "Until")}</label>
                <input type="date" value={effectiveUntil} onChange={(e) => setEffectiveUntil(e.target.value)} className="input" />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" className="btn btn-secondary" onClick={() => { setCreateOpen(false); resetForm(); }}>{t("common.cancel", "Cancel")}</button>
                <FormButton type="submit" isLoading={createMutation.isPending || updateMutation.isPending}>{editingEntry ? t("common.save", "Save") : t("common.create", "Create")}</FormButton>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        entityName={t("scheduling.scheduleEntry", "Schedule entry")}
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        message={t("deleted.confirm", "It will be archived and can be restored later.")}
      />
    </>
  );
}
