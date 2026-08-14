"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, ChevronDown, ChevronUp, CalendarDays, AlertTriangle, ShieldCheck } from "lucide-react";
import { schedulingApi } from "@/lib/api/scheduling.api";
import { useProfessors, useGroups } from "@/hooks/use-queries";
import { useClassrooms, useConflicts, useScheduleEntries, useWorkingHours, ACTIVE_ENTRIES } from "@/hooks/use-scheduling";
import type { ScheduleEntry, Professor, Group, Classroom, TimeSlot, Conflict } from "@/types";
import { PageLoader } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/empty-state";
import { FormButton, ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import { useTranslation } from "@/lib/i18n/context";
import { checkWorkingHours, describeWindows, isValidRange, nextDateForSchoolDay } from "@/lib/utils/scheduling";
import { ClassroomPicker } from "@/components/scheduling/classroom-picker";

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

  // Through the shared hook, so this and the groups page hit one cache entry
  // rather than fetching the same list under two different keys.
  const { data: entries, isLoading } = useScheduleEntries(ACTIVE_ENTRIES);

  const { data: professors } = useProfessors();
  const { data: groups } = useGroups();
  const { data: classrooms } = useClassrooms();


  const [search, setSearch] = useState("");
  const [filterGroupId, setFilterGroupId] = useState("");
  const [filterProfId, setFilterProfId] = useState("");
  const [filterClassroomId, setFilterClassroomId] = useState("");
  const [filterDay, setFilterDay] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ScheduleEntry | null>(null);
  const [formGroupId, setFormGroupId] = useState("");
  const [formDayOfWeek, setFormDayOfWeek] = useState(0);
  const [formStartTime, setFormStartTime] = useState("09:00");
  const [formEndTime, setFormEndTime] = useState("10:30");
  const [formClassroomId, setFormClassroomId] = useState("");
  const [formProfId, setFormProfId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveUntil, setEffectiveUntil] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: workingHours } = useWorkingHours();

  const rangeValid = isValidRange(formStartTime, formEndTime);
  const hoursCheck = useMemo(
    () => checkWorkingHours(workingHours, formDayOfWeek, formStartTime, formEndTime),
    [workingHours, formDayOfWeek, formStartTime, formEndTime],
  );
  const hoursStatus = rangeValid ? hoursCheck.status : "unconfigured";

  /**
   * The concrete date the window lands on, for the availability lookup.
   *
   * Anchored on `effective_from` when one is set, because which rules are in
   * force depends on the date, and a rule starting next term should be checked
   * against next term.
   */
  const availabilityDate = useMemo(
    () => (effectiveFrom ? nextDateForSchoolDay(formDayOfWeek, new Date(effectiveFrom + "T00:00:00")) : nextDateForSchoolDay(formDayOfWeek)),
    [effectiveFrom, formDayOfWeek],
  );

  // Reported by `ClassroomPicker`, which owns the lookup. Running a second
  // query here to answer the same question meant two requests whose keys did
  // not quite match, so neither could serve the other from cache.
  const [roomState, setRoomState] = useState({ selectedBusy: false, noneFree: false });
  const selectedRoomBusy = !!formClassroomId && roomState.selectedBusy;

  /**
   * The API refuses these, so the form does not offer to send them.
   *
   * On edit only the room is in play: the window is fixed and is not
   * resubmitted, so judging the form on it would make a session that predates
   * the opening-hours rule permanently uneditable — including for the one
   * change that could fix it.
   */
  const submitBlocked = editingEntry
    ? selectedRoomBusy
    : !rangeValid || hoursStatus === "partial" || hoursStatus === "outside" || selectedRoomBusy;

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
      if (filterDay !== "" && e.time_slot?.day_of_week !== Number(filterDay)) return false;
      return true;
    });
  }, [entries, search, filterGroupId, filterProfId, filterClassroomId, filterDay]);

  const resetForm = () => {
    setFormGroupId("");
    setFormDayOfWeek(0);
    setFormStartTime("09:00");
    setFormEndTime("10:30");
    setFormClassroomId("");
    setFormProfId("");
    setEffectiveFrom("");
    setEffectiveUntil("");
    setEditingEntry(null);
    setFormError(null);
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => schedulingApi.entries.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduling"] });
      setCreateOpen(false);
      resetForm();
    },
    // The API refuses out-of-hours windows and taken rooms; the reason names
    // what to change, so it is shown in the form rather than swallowed.
    onError: (err: any) =>
      setFormError(
        err?.response?.data?.error?.message ||
          err?.response?.data?.message ||
          t("scheduling.saveFailed", "Enregistrement impossible"),
      ),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => schedulingApi.entries.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduling"] });
      setCreateOpen(false);
      resetForm();
    },
    // The API refuses out-of-hours windows and taken rooms; the reason names
    // what to change, so it is shown in the form rather than swallowed.
    onError: (err: any) =>
      setFormError(
        err?.response?.data?.error?.message ||
          err?.response?.data?.message ||
          t("scheduling.saveFailed", "Enregistrement impossible"),
      ),
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
    setFormDayOfWeek(entry.time_slot?.day_of_week ?? 0);
    setFormStartTime(String(entry.time_slot?.start_time ?? "09:00").slice(0, 5));
    setFormEndTime(String(entry.time_slot?.end_time ?? "10:30").slice(0, 5));
    setFormClassroomId(entry.classroom_id ?? "");
    setFormProfId(entry.prof_id);
    setEffectiveFrom(entry.effective_from.split("T")[0]);
    setEffectiveUntil(entry.effective_until ? entry.effective_until.split("T")[0] : "");
    setFormError(null);
    setCreateOpen(true);
  };

  const openCreate = () => {
    resetForm();
    setEffectiveFrom(new Date().toISOString().split("T")[0]);
    setCreateOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formGroupId || !formProfId || !effectiveFrom || submitBlocked) return;
    setFormError(null);
    const data = {
      group_id: formGroupId,
      // Times, not a slot id: the API resolves them to a stored slot itself.
      day_of_week: formDayOfWeek,
      start_time: formStartTime,
      end_time: formEndTime,
      classroom_id: formClassroomId || null,
      prof_id: formProfId,
      effective_from: effectiveFrom,
      effective_until: effectiveUntil || null,
    };
    if (editingEntry) {
      // Update only accepts the fields it owns; the window is changed by
      // re-creating through the builder, as before.
      updateMutation.mutate({
        id: editingEntry.id,
        data: { classroom_id: data.classroom_id, effective_until: data.effective_until },
      });
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
              {/* Filtering by weekday, not by a declared slot: sessions are no
                  longer drawn from a catalogue, so "which day" is the question
                  that still has a fixed set of answers. */}
              <div>
                <label className="block text-xs font-medium mb-1">{t("scheduling.day", "Jour")}</label>
                <select value={filterDay} onChange={(e) => setFilterDay(e.target.value)} className="input text-xs">
                  <option value="">{t("common.all", "Tous")}</option>
                  {DAY_NAMES.map((label, day) => (
                    <option key={day} value={String(day)}>{label}</option>
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
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("scheduling.schedule", "Horaire")}</th>
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
              {/*
                The day and the two times, typed directly. This was a dropdown
                of `time_slots` rows, so a session could only be placed at a
                window someone had declared in a separate admin screen first.
              */}
              {/*
                The window is fixed once a rule exists: `PUT /entries/:id` only
                owns the room and the end date, and moving a session in time is
                the split/"this and following" operation the calendar runs. The
                fields are shown disabled rather than hidden so the session is
                still identifiable, with a line saying where to change them —
                editable-looking inputs that silently discard their value would
                be worse than either.
              */}
              <div>
                <label htmlFor="entry-day" className="block text-sm font-medium mb-1">{t("scheduling.day", "Jour")} *</label>
                <select
                  id="entry-day"
                  value={formDayOfWeek}
                  onChange={(e) => setFormDayOfWeek(Number(e.target.value))}
                  className="input disabled:opacity-60"
                  required
                  disabled={!!editingEntry}
                >
                  {DAY_NAMES.map((label, day) => (
                    <option key={day} value={day}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="entry-start" className="block text-sm font-medium mb-1">{t("scheduling.startTime", "Début")} *</label>
                  <input
                    id="entry-start"
                    type="time"
                    value={formStartTime}
                    onChange={(e) => setFormStartTime(e.target.value)}
                    className={`input w-full disabled:opacity-60 ${hoursStatus === "partial" || hoursStatus === "outside" ? "border-danger/50" : ""}`}
                    required
                    disabled={!!editingEntry}
                  />
                </div>
                <div>
                  <label htmlFor="entry-end" className="block text-sm font-medium mb-1">{t("scheduling.endTime", "Fin")} *</label>
                  <input
                    id="entry-end"
                    type="time"
                    value={formEndTime}
                    onChange={(e) => setFormEndTime(e.target.value)}
                    className={`input w-full disabled:opacity-60 ${!rangeValid && formEndTime ? "border-danger/50" : hoursStatus === "partial" || hoursStatus === "outside" ? "border-danger/50" : ""}`}
                    required
                    disabled={!!editingEntry}
                  />
                </div>
              </div>

              {editingEntry && (
                <p className="text-xs text-text-secondary">
                  {t(
                    "scheduling.windowFixedOnEdit",
                    "L'horaire d'une séance existante se change depuis le calendrier (« Décaler la série »).",
                  )}
                </p>
              )}

              {formEndTime && formStartTime && !rangeValid && (
                <p role="alert" className="text-xs text-danger">
                  {t("scheduling.endBeforeStart", "La fin doit être après le début.")}
                </p>
              )}

              {!editingEntry && rangeValid && (hoursStatus === "partial" || hoursStatus === "outside") && (
                <p role="alert" className="text-xs text-danger">
                  {hoursStatus === "partial"
                    ? t("scheduling.partiallyOutsideHours", "Ce créneau dépasse les horaires d'ouverture. Ramenez-le à l'intérieur de :")
                    : t("scheduling.outsideHours", "Ce créneau est en dehors des horaires d'ouverture. Horaires de ce jour :")}{" "}
                  <span className="font-semibold tabular-nums">{describeWindows(hoursCheck.windows)}</span>
                </p>
              )}

              <div>
                <label id="entry-room-label" className="block text-sm font-medium mb-1">{t("nav.classrooms", "Salle")}</label>
                {/* The shared picker, so this screen, the calendar's move and
                    room dialogs all report availability the same way. */}
                <ClassroomPicker
                  labelId="entry-room-label"
                  value={formClassroomId}
                  onChange={setFormClassroomId}
                  date={availabilityDate}
                  startTime={formStartTime}
                  endTime={formEndTime}
                  excludeGroupId={formGroupId || undefined}
                  excludeEntryId={editingEntry?.id}
                  classrooms={classrooms ?? []}
                  allowEmpty
                  onAvailabilityChange={setRoomState}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("scheduling.from", "From")} *</label>
                <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="input" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("scheduling.until", "Until")}</label>
                <input type="date" value={effectiveUntil} onChange={(e) => setEffectiveUntil(e.target.value)} className="input" />
              </div>
              {formError && (
                <p role="alert" className="text-xs text-danger">{formError}</p>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button type="button" className="btn btn-secondary" onClick={() => { setCreateOpen(false); resetForm(); }}>{t("common.cancel", "Cancel")}</button>
                <FormButton
                  type="submit"
                  isLoading={createMutation.isPending || updateMutation.isPending}
                  disabled={submitBlocked}
                  title={submitBlocked ? t("scheduling.fixBlockingFirst", "Corrigez les créneaux signalés pour enregistrer.") : undefined}
                >{editingEntry ? t("common.save", "Save") : t("common.create", "Create")}</FormButton>
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
