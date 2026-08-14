"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, ChevronDown, ChevronUp, CalendarDays, AlertTriangle, ShieldCheck, X, Clock, Info, Layers, DoorOpen, StickyNote } from "lucide-react";
import { schedulingApi } from "@/lib/api/scheduling.api";
import { useProfessors, useGroups } from "@/hooks/use-queries";
import { useClassrooms, useConflicts, useScheduleEntries, useWorkingHours, ACTIVE_ENTRIES } from "@/hooks/use-scheduling";
import type { ScheduleEntry, Professor, Group, Classroom, TimeSlot, Conflict } from "@/types";
import { PageLoader } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/empty-state";
import { FormButton, ConfirmDeleteDialog } from "@/components/forms/form-helpers";
import { useTranslation } from "@/lib/i18n/context";
import { checkWorkingHours, describeWindows, durationLabel, isValidRange, nextDateForSchoolDay, windowsForDay } from "@/lib/utils/scheduling";
import { ClassroomPicker } from "@/components/scheduling/classroom-picker";

const DAY_NAMES = ["Sam", "Dim", "Lun", "Mar", "Mer", "Jeu", "Ven"];

/** A section heading inside the session dialog. */
function SectionLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
      {icon}
      {children}
    </h4>
  );
}

/** An inline validation message, styled once so every field reads the same. */
function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 rounded-btn border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-[11px] text-danger dark:bg-danger/10 dark:text-danger-dark-strong">
      <AlertTriangle size={12} className="mt-px shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

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
      /*
        `text-success-700` used to sit here, and the `success` token has no
        numeric scale — only DEFAULT / soft / strong and their dark variants —
        so the class generated nothing and the text fell back to whatever it
        inherited. Paired with `bg-success-soft`, a fixed pale green applied in
        both themes, that meant light text on a light panel in dark mode: the
        line was there but invisible. Both halves now carry a dark variant.
      */
      <div className="flex items-center gap-2 rounded-btn border border-success/30 bg-success-soft px-3 py-2 dark:bg-success/10">
        <ShieldCheck size={15} className="shrink-0 text-success-strong dark:text-success-dark" aria-hidden="true" />
        <p className="text-xs font-medium text-success-strong dark:text-success-dark-strong">
          {t("scheduling.noConflicts", "Aucun conflit dans l'emploi du temps.")}
        </p>
      </div>
    );
  }

  return (
    /*
      Same fix on the warning state: `bg-gold-50` and the white chip fills are
      fixed light colours, so this panel stayed a bright cream card in a dark
      UI. The gold scale is real (unlike `success-700`), so only the surfaces
      needed dark variants.
    */
    <div className="rounded-card border border-gold/40 bg-gold-50 dark:bg-gold/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-gold-100/60 dark:hover:bg-gold/15"
      >
        <AlertTriangle size={15} className="shrink-0 text-gold-500 dark:text-gold-300" aria-hidden="true" />
        <p className="text-xs font-medium text-gold-700 dark:text-gold-200">
          {conflicts.length} {t("scheduling.conflictsDetected", "conflit(s) détecté(s)")}
        </p>
        <span className="ml-2 flex items-center gap-1.5">
          {Array.from(byType.entries()).map(([type, list]: [string, Conflict[]]) => (
            <span
              key={type}
              className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-gold-700 dark:bg-white/10 dark:text-gold-200"
            >
              {CONFLICT_META[type]?.label ?? type} {list.length}
            </span>
          ))}
        </span>
        <ChevronDown
          size={14}
          className={`ml-auto text-gold-600 dark:text-gold-300 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="border-t border-gold/30 bg-white/50 dark:bg-black/20 divide-y divide-gold/20 max-h-64 overflow-y-auto">
          {Array.from(byType.entries()).map(([type, list]: [string, Conflict[]]) => (
            <div key={type} className="px-3 py-2">
              <p className="text-[11px] font-semibold text-gold-700 dark:text-gold-200 mb-1">
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
  const [formNotes, setFormNotes] = useState("");
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
    // The soonest matching weekday from today: a rule now starts today, so that
    // is the first date its availability is actually being asked about.
    () => nextDateForSchoolDay(formDayOfWeek),
    [formDayOfWeek],
  );

  // Reported by `ClassroomPicker`, which owns the lookup. Running a second
  // query here to answer the same question meant two requests whose keys did
  // not quite match, so neither could serve the other from cache.
  const [roomState, setRoomState] = useState({ selectedBusy: false, noneFree: false });
  const selectedRoomBusy = !!formClassroomId && roomState.selectedBusy;

  /** Closes the dialog and clears the draft — used by the X, Cancel and backdrop. */
  const closeForm = useCallback(() => {
    setCreateOpen(false);
    resetForm();
  }, []);

  /** The day's declared opening hours, shown beside the time fields. */
  const dayWindows = useMemo(() => windowsForDay(workingHours, formDayOfWeek), [workingHours, formDayOfWeek]);

  const sessionDuration = durationLabel(formStartTime, formEndTime);

  /** Both time inputs go red together — the window is wrong, not one field. */
  const timeFieldsInvalid =
    (!!formStartTime && !!formEndTime && !rangeValid) ||
    (!editingEntry && rangeValid && (hoursStatus === "partial" || hoursStatus === "outside"));

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
    setFormNotes("");
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

  // Escape closes, as it does on the delete dialog — a modal only the mouse can
  // dismiss is the odd one out in this app. Declared after the mutations
  // because it reads their pending state to avoid closing mid-save.
  useEffect(() => {
    if (!createOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !createMutation.isPending && !updateMutation.isPending) closeForm();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [createOpen, closeForm, createMutation.isPending, updateMutation.isPending]);

  const openEdit = (entry: ScheduleEntry) => {
    setEditingEntry(entry);
    setFormGroupId(entry.group_id);
    setFormDayOfWeek(entry.time_slot?.day_of_week ?? 0);
    setFormStartTime(String(entry.time_slot?.start_time ?? "09:00").slice(0, 5));
    setFormEndTime(String(entry.time_slot?.end_time ?? "10:30").slice(0, 5));
    setFormClassroomId(entry.classroom_id ?? "");
    setFormProfId(entry.prof_id);
    setFormNotes(entry.notes ?? "");
    setFormError(null);
    setCreateOpen(true);
  };

  const openCreate = () => {
    resetForm();
    setCreateOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formGroupId || !formProfId || submitBlocked) return;
    setFormError(null);
    const data = {
      group_id: formGroupId,
      // Times, not a slot id: the API resolves them to a stored slot itself.
      day_of_week: formDayOfWeek,
      start_time: formStartTime,
      end_time: formEndTime,
      classroom_id: formClassroomId || null,
      prof_id: formProfId,
      notes: formNotes.trim() || undefined,
      // No effective range: the server starts the rule today and leaves it
      // open-ended. Ending it is a separate, deliberate act from the calendar.
    };
    if (editingEntry) {
      // Update only accepts the fields it owns; the window is changed by
      // re-creating through the builder, as before.
      updateMutation.mutate({
        id: editingEntry.id,
        data: { classroom_id: data.classroom_id, notes: data.notes ?? "" },
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
                  {/* The From/Until columns are gone with the form fields that
                      fed them: every new rule now starts today and runs
                      open-ended, so one column repeated the creation date and
                      the other was always "—". Notes takes the space, which is
                      also what makes the new field visible after saving. */}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase">{t("scheduling.sectionNotes", "Notes")}</th>
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
                    <td className="max-w-[220px] px-4 py-3 text-text-secondary">
                      {entry.notes ? (
                        <span className="block truncate" title={entry.notes}>{entry.notes}</span>
                      ) : (
                        "—"
                      )}
                    </td>
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
        /*
          The session form, as four labelled steps rather than eight stacked
          fields in a `max-w-sm` column.
          The order is the one the rules are applied in — who and what, then
          when, then where, then for how long — because the room's availability
          depends on the window above it, and asking for the room first invites
          a choice that the times then invalidate.
          The dialog is a column: header and actions stay put while only the
          fields scroll, so on a short laptop screen the submit button is still
          reachable without scrolling a modal that has no visible scrollbar.
        */
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="entry-dialog-title"
          onClick={closeForm}
        >
          <div
            className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-modal bg-surface shadow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <h3 id="entry-dialog-title" className="text-h4 font-bold text-text-primary">
                  {editingEntry ? t("scheduling.editEntry", "Modifier la séance") : t("scheduling.newEntry", "Nouvelle séance")}
                </h3>
                <p className="mt-0.5 text-xs text-text-secondary">
                  {editingEntry
                    ? t("scheduling.editEntryHint", "Salle et date de fin. L'horaire se change depuis le calendrier.")
                    : t("scheduling.newEntryHint", "Une séance hebdomadaire, répétée jusqu'à la date de fin.")}
                </p>
              </div>
              <button
                type="button"
                onClick={closeForm}
                aria-label={t("common.close", "Fermer")}
                className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-btn text-text-secondary transition-colors hover:bg-background hover:text-text-primary"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                <section className="space-y-3">
                  <SectionLabel icon={<Layers size={12} aria-hidden="true" />}>
                    {t("scheduling.sectionWhat", "Séance")}
                  </SectionLabel>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="entry-group" className="mb-1 block text-xs font-medium text-text-secondary">
                        {t("fieldsHierarchy.group", "Groupe")} *
                      </label>
                      <select id="entry-group" value={formGroupId} onChange={(e) => setFormGroupId(e.target.value)} className="input w-full" required>
                        <option value="">{t("students.selectGroup", "Choisir un groupe")}</option>
                        {groups?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="entry-prof" className="mb-1 block text-xs font-medium text-text-secondary">
                        {t("fieldsHierarchy.professor", "Professeur")} *
                      </label>
                      <select id="entry-prof" value={formProfId} onChange={(e) => setFormProfId(e.target.value)} className="input w-full" required>
                        <option value="">{t("students.selectProfessor", "Choisir un professeur")}</option>
                        {professors?.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                      </select>
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <SectionLabel icon={<CalendarDays size={12} aria-hidden="true" />}>
                    {t("scheduling.sectionWhen", "Horaire")}
                  </SectionLabel>

                  <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
                    <div>
                      <label htmlFor="entry-day" className="mb-1 block text-xs font-medium text-text-secondary">
                        {t("scheduling.day", "Jour")} *
                      </label>
                      <select
                        id="entry-day"
                        value={formDayOfWeek}
                        onChange={(e) => setFormDayOfWeek(Number(e.target.value))}
                        className="input w-full disabled:opacity-60"
                        required
                        disabled={!!editingEntry}
                      >
                        {DAY_NAMES.map((label, day) => (
                          <option key={day} value={day}>{label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="entry-start" className="mb-1 block text-xs font-medium text-text-secondary">
                        {t("scheduling.startTime", "Début")} *
                      </label>
                      <input
                        id="entry-start"
                        type="time"
                        value={formStartTime}
                        onChange={(e) => setFormStartTime(e.target.value)}
                        className={`input w-full tabular-nums disabled:opacity-60 ${timeFieldsInvalid ? "border-danger/60" : ""}`}
                        required
                        disabled={!!editingEntry}
                        aria-invalid={timeFieldsInvalid || undefined}
                      />
                    </div>
                    <span className="hidden pb-2 text-text-secondary sm:block" aria-hidden="true">→</span>
                    <div>
                      <label htmlFor="entry-end" className="mb-1 block text-xs font-medium text-text-secondary">
                        {t("scheduling.endTime", "Fin")} *
                      </label>
                      <input
                        id="entry-end"
                        type="time"
                        value={formEndTime}
                        onChange={(e) => setFormEndTime(e.target.value)}
                        className={`input w-full tabular-nums disabled:opacity-60 ${timeFieldsInvalid ? "border-danger/60" : ""}`}
                        required
                        disabled={!!editingEntry}
                        aria-invalid={timeFieldsInvalid || undefined}
                      />
                    </div>
                  </div>

                  {/* The length of the session, and the day's opening hours —
                      the two things the two time inputs do not say themselves. */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-secondary">
                    {sessionDuration && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 font-medium tabular-nums">
                        <Clock size={10} aria-hidden="true" />
                        {sessionDuration}
                      </span>
                    )}
                    {dayWindows.length > 0 && (
                      <span className="tabular-nums">
                        {t("scheduling.dayHours", "Horaires d'ouverture ce jour :")}{" "}
                        <span className="font-medium text-text-primary">{describeWindows(dayWindows)}</span>
                      </span>
                    )}
                  </div>

                  {editingEntry && (
                    <p className="flex items-start gap-1.5 rounded-btn border border-border bg-background px-2.5 py-1.5 text-[11px] text-text-secondary">
                      <Info size={12} className="mt-px shrink-0" aria-hidden="true" />
                      {t(
                        "scheduling.windowFixedOnEdit",
                        "L'horaire d'une séance existante se change depuis le calendrier (« Décaler la série »).",
                      )}
                    </p>
                  )}

                  {formEndTime && formStartTime && !rangeValid && (
                    <FieldError>{t("scheduling.endBeforeStart", "La fin doit être après le début.")}</FieldError>
                  )}

                  {!editingEntry && rangeValid && (hoursStatus === "partial" || hoursStatus === "outside") && (
                    <FieldError>
                      {hoursStatus === "partial"
                        ? t("scheduling.partiallyOutsideHours", "Ce créneau dépasse les horaires d'ouverture. Ramenez-le à l'intérieur de :")
                        : t("scheduling.outsideHours", "Ce créneau est en dehors des horaires d'ouverture. Horaires de ce jour :")}{" "}
                      <span className="font-semibold tabular-nums">{describeWindows(hoursCheck.windows)}</span>
                    </FieldError>
                  )}
                </section>

                <section className="space-y-3">
                  <SectionLabel icon={<DoorOpen size={12} aria-hidden="true" />}>
                    {t("nav.classrooms", "Salle")}
                  </SectionLabel>
                  {/* The shared picker, so this screen, the calendar's move and
                      room dialogs all report availability the same way. */}
                  <ClassroomPicker
                    labelId="entry-dialog-title"
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
                </section>

                {/*
                  The "du / au" period fields are gone. A session is a weekly
                  rule that runs from now until it is ended, and the series is
                  ended from the calendar ("Terminer la série") where the dates
                  are visible — asking for two dates up front made every new
                  session a decision about a term boundary nobody had in mind.
                  The rule still carries an effective range; the server starts
                  it today and leaves it open, exactly as the weekly timetable
                  builder already did.
                */}
                <section className="space-y-3">
                  <SectionLabel icon={<StickyNote size={12} aria-hidden="true" />}>
                    {t("scheduling.sectionNotes", "Notes")}
                  </SectionLabel>
                  <div>
                    <label htmlFor="entry-notes" className="mb-1 block text-xs font-medium text-text-secondary">
                      {t("scheduling.notesOptional", "Remarques (optionnel)")}
                    </label>
                    <textarea
                      id="entry-notes"
                      value={formNotes}
                      onChange={(e) => setFormNotes(e.target.value)}
                      rows={3}
                      maxLength={500}
                      className="input w-full resize-y"
                      placeholder={t("scheduling.notesPlaceholder", "Matériel requis, salle partagée, consignes…")}
                    />
                    <p className="mt-1 text-right text-[11px] tabular-nums text-text-secondary">
                      {formNotes.length}/500
                    </p>
                  </div>
                </section>
              </div>

              <footer className="shrink-0 space-y-2 border-t border-border px-5 py-3">
                {formError && (
                  <p role="alert" className="flex items-start gap-1.5 text-xs text-danger">
                    <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden="true" />
                    {formError}
                  </p>
                )}
                <div className="flex items-center justify-end gap-3">
                  <button type="button" className="btn btn-secondary text-sm" onClick={closeForm}>
                    {t("common.cancel", "Annuler")}
                  </button>
                  <FormButton
                    type="submit"
                    className="text-sm"
                    isLoading={createMutation.isPending || updateMutation.isPending}
                    disabled={submitBlocked}
                    title={submitBlocked ? t("scheduling.fixBlockingFirst", "Corrigez les créneaux signalés pour enregistrer.") : undefined}
                  >
                    {editingEntry ? t("common.save", "Enregistrer") : t("common.create", "Créer la séance")}
                  </FormButton>
                </div>
              </footer>
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
