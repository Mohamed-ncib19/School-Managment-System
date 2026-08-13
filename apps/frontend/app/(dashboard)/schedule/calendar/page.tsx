"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, CalendarDays, CalendarClock, X, ArrowLeftRight, UserX, DoorOpen, Layers, Ban, Slice, SlidersHorizontal, RotateCcw } from "lucide-react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { useOccurrences, useCreateEntryException, useRemoveEntryException, useSplitEntry, useEndEntrySeries } from "@/hooks/use-scheduling";
import { useProfessors, useGroups } from "@/hooks/use-queries";
import { useClassrooms, useTimeSlots } from "@/hooks/use-scheduling";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { FormButton } from "@/components/forms/form-helpers";
import { PageLoader } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/empty-state";
import { useTranslation } from "@/lib/i18n/context";
import type { Occurrence, ScheduleEntryException } from "@/types";

const DAY_NAMES = ["Sam", "Dim", "Lun", "Mar", "Mer", "Jeu", "Ven"];

type DialogMode = "view" | "cancel" | "move" | "substitute" | "room" | "split" | "end";

function apiError(err: unknown, fallback: string): string {
  const anyErr = err as any;
  const msg = anyErr?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(", ");
  if (typeof msg === "string" && msg) return msg;
  const conflicts = anyErr?.response?.data?.conflicts;
  if (Array.isArray(conflicts) && conflicts.length > 0) {
    return conflicts
      .map((c: any) => `${c.entityName}: ${c.timeSlotLabel}`)
      .join(" · ");
  }
  return fallback;
}

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const STATUS_LABEL: Record<string, string> = {
  normal: "Séance",
  cancelled: "Annulée",
  moved: "Déplacée",
  substitute: "Remplacement",
  room_change: "Changement de salle",
  student_cancelled: "Annulée (étudiant)",
  student_substitute: "Remplacement (étudiant)",
  makeup: "Rattrapage",
};

/** Status colours, so the badge carries the same meaning as the calendar. */
const STATUS_TONE: Record<string, string> = {
  normal: "bg-success-soft text-success",
  cancelled: "bg-danger-soft text-danger",
  student_cancelled: "bg-danger-soft text-danger",
  moved: "bg-primary-50 text-primary",
  substitute: "bg-gold-50 text-gold-700",
  student_substitute: "bg-gold-50 text-gold-700",
  room_change: "bg-gold-50 text-gold-700",
  makeup: "bg-primary-50 text-primary",
};

/**
 * One labelled detail, styled like a list-view column header.
 *
 * The dialog used a two-column `dl` whose labels were plain body text, so the
 * value and the name of the value read at the same weight. Matching the table
 * headers keeps a session recognisable across the two places it appears.
 */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2.5">
      <dt className="text-xs font-semibold text-text-secondary uppercase tracking-wider shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-text-primary text-right min-w-0">{children}</dd>
    </div>
  );
}

export default function ScheduleCalendarPage() {
  return (
    <Suspense fallback={<PageLoader text="Loading…" />}>
      <CalendarInner />
    </Suspense>
  );
}

function CalendarInner() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const { data: professors } = useProfessors();
  const { data: groups } = useGroups();
  const { data: classrooms } = useClassrooms();
  const { data: timeSlots } = useTimeSlots();

  const [range, setRange] = useState<{ from: string; to: string }>(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: iso(from), to: iso(to) };
  });
  const [view, setView] = useState<"dayGridMonth" | "timeGridWeek">("dayGridMonth");
  const [filters, setFilters] = useState<{ groupId?: string; profId?: string; classroomId?: string; search?: string }>(() => ({
    groupId: searchParams.get("groupId") ?? undefined,
    profId: searchParams.get("profId") ?? undefined,
    classroomId: searchParams.get("classroomId") ?? undefined,
  }));
  const [dialog, setDialog] = useState<{ occ: Occurrence; mode: DialogMode } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const calendarRef = useRef<FullCalendar | null>(null);

  useEffect(() => {
    calendarRef.current?.getApi().changeView(view);
  }, [view]);

  // Each occurrence request re-expands every recurring rule over the visible
  // range, so the search term is debounced rather than sent per keystroke.
  const debouncedSearch = useDebouncedValue(filters.search ?? "", 300);
  const { data: occurrences, isLoading } = useOccurrences({
    ...range,
    ...filters,
    search: debouncedSearch || undefined,
  });

  const handleDatesSet = useCallback((info: any) => {
    setRange({ from: iso(info.start), to: iso(info.end) });
  }, []);

  const events = useMemo(() => (occurrences ?? []).map(toEvent), [occurrences]);

  /** Only the academic selects count — the search box shows its own text. */
  const activeFilterCount = [filters.groupId, filters.profId, filters.classroomId].filter(Boolean).length;

  /** What is currently narrowing the view, named rather than left implicit. */
  const activeChips = useMemo(() => {
    const chips: { key: "groupId" | "profId" | "classroomId"; label: string }[] = [];
    if (filters.groupId) {
      const name = groups?.find((g) => g.id === filters.groupId)?.name;
      if (name) chips.push({ key: "groupId", label: name });
    }
    if (filters.profId) {
      const name = professors?.find((p) => p.id === filters.profId)?.full_name;
      if (name) chips.push({ key: "profId", label: name });
    }
    if (filters.classroomId) {
      const name = classrooms?.find((c) => c.id === filters.classroomId)?.name;
      if (name) chips.push({ key: "classroomId", label: name });
    }
    return chips;
  }, [filters, groups, professors, classrooms]);

  const selectOccurrence = (arg: any) => {
    const occ = (arg.event.extendedProps as any).occ as Occurrence | undefined;
    if (occ) setDialog({ occ, mode: "view" });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-h4 font-bold text-text-primary">{t("nav.scheduleCalendar", "Schedule calendar")}</h2>
          <p className="text-xs text-text-secondary mt-1">{t("scheduling.calendarSubtitle", "Every concrete session of every rule — click one to cancel, move, substitute, or edit its series.")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`btn text-xs ${view === "dayGridMonth" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setView("dayGridMonth")}
          >
            <CalendarDays size={14} /> {t("scheduling.month", "Month")}
          </button>
          <button
            className={`btn text-xs ${view === "timeGridWeek" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setView("timeGridWeek")}
          >
            <CalendarClock size={14} /> {t("scheduling.week", "Week")}
          </button>
        </div>
      </div>

      {/*
        A search box and a filter toggle, rather than four controls competing
        with the calendar for the top of the page. The selects only appear when
        asked for; what is actually narrowing the view stays visible as chips,
        so an accidentally-left filter cannot silently hide half the timetable.
      */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
            <input
              type="text"
              placeholder={t("scheduling.searchPlaceholder", "Groupe, professeur ou étudiant…")}
              value={filters.search ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value || undefined }))}
              className="input pl-9 w-full text-xs"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            aria-expanded={showFilters}
            className={`btn text-xs ${activeFilterCount > 0 ? "btn-primary" : "btn-secondary"}`}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            {t("common.filters", "Filtres")}
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-white/25 px-1 text-[10px] font-semibold tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </button>
          <span className="text-xs text-text-secondary tabular-nums ml-auto">
            {occurrences?.length ?? 0} {t("scheduling.sessions", "séance(s)")}
          </span>
        </div>

        {showFilters && (
          <div className="card flex flex-wrap items-center gap-2">
            <select value={filters.groupId ?? ""} onChange={(e) => setFilters((f) => ({ ...f, groupId: e.target.value || undefined }))} className="input text-xs">
              <option value="">{t("fieldsHierarchy.group", "Groupe")} : {t("common.all", "Tous")}</option>
              {groups?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select value={filters.profId ?? ""} onChange={(e) => setFilters((f) => ({ ...f, profId: e.target.value || undefined }))} className="input text-xs">
              <option value="">{t("fieldsHierarchy.professor", "Professeur")} : {t("common.all", "Tous")}</option>
              {professors?.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
            <select value={filters.classroomId ?? ""} onChange={(e) => setFilters((f) => ({ ...f, classroomId: e.target.value || undefined }))} className="input text-xs">
              <option value="">{t("nav.classrooms", "Salle")} : {t("common.all", "Toutes")}</option>
              {classrooms?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        {activeChips.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {activeChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => setFilters((f) => ({ ...f, [chip.key]: undefined }))}
                className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary-50 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary-100 transition-colors"
              >
                {chip.label}
                <X size={11} aria-hidden="true" />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setFilters({})}
              className="text-[11px] text-text-secondary hover:text-text-primary underline underline-offset-2"
            >
              {t("common.clearAll", "Tout effacer")}
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <PageLoader text={t("common.loading", "Loading…")} />
      ) : !occurrences?.length ? (
        <EmptyState message={t("scheduling.noOccurrences", "No sessions in this range")} />
      ) : (
        <div className="card overflow-hidden">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={view}
            datesSet={handleDatesSet}
            events={events}
            eventClick={selectOccurrence}
            firstDay={6}
            height="auto"
            headerToolbar={{ left: "prev,next today", center: "title", right: "" }}
            slotMinTime="07:00:00"
            slotMaxTime="21:00:00"
            slotDuration="00:30:00"
            allDaySlot={false}
            eventDisplay="block"
            eventContent={EventContent}
          />
        </div>
      )}

      {dialog && (
        <OccurrenceDialog
          occ={dialog.occ}
          mode={dialog.mode}
          onClose={() => setDialog(null)}
          onChangeMode={(mode) => setDialog((d) => (d ? { ...d, mode } : d))}
          timeSlots={timeSlots ?? []}
          professors={professors ?? []}
          classrooms={classrooms ?? []}
        />
      )}
    </div>
  );
}

function toEvent(occ: Occurrence) {
  const cancelled = occ.status === "cancelled" || occ.status === "student_cancelled";
  const color = cancelled ? "#94a3b8" : (occ.color ?? occ.group.color ?? "#0ea5e9");
  return {
    id: occ.occurrenceId,
    title: `${occ.group.name} · ${occ.professor?.full_name ?? ""}`,
    start: `${occ.date}T${occ.start_time}`,
    end: `${occ.date}T${occ.end_time}`,
    backgroundColor: color,
    borderColor: color,
    textColor: "#fff",
    extendedProps: { occ },
  };
}

function EventContent(info: any) {
  const occ = info.event.extendedProps.occ as Occurrence;
  const cancelled = occ.status === "cancelled" || occ.status === "student_cancelled";
  const style = cancelled
    ? { backgroundColor: "#94a3b8", borderColor: "#94a3b8" }
    : {
        backgroundColor: occ.color ?? occ.group.color ?? "#0ea5e9",
        borderColor: occ.color ?? occ.group.color ?? "#0ea5e9",
      };
  return (
    <div
      className="flex flex-col gap-0.5 overflow-hidden rounded px-1.5 py-1 text-white cursor-pointer transition-opacity hover:opacity-90"
      style={style}
      title={`${occ.group.name}${occ.group.field ? ` · ${occ.group.field.name}` : ""}\n${occ.start_time.slice(0, 5)}–${occ.end_time.slice(0, 5)}\n${occ.professor?.full_name ?? ""}${occ.classroom ? `\n${occ.classroom.name}` : ""}`}
    >
      <span className={`text-[11px] font-semibold leading-tight truncate ${cancelled ? "line-through" : ""}`}>
        {occ.group.name}
      </span>
      {/* The academic field is what a timetable calls the subject. */}
      {occ.group.field && (
        <span className="text-[10px] leading-tight truncate opacity-95 font-medium">{occ.group.field.name}</span>
      )}
      <span className="text-[10px] leading-tight truncate opacity-85">
        {occ.professor?.full_name}
        {occ.classroom ? ` · ${occ.classroom.name}` : ""}
      </span>
      {occ.status !== "normal" && (
        <span className="mt-0.5 inline-flex w-fit rounded bg-black/25 px-1 text-[9px] leading-[14px] uppercase tracking-wide font-semibold">
          {STATUS_LABEL[occ.status] ?? occ.status}
        </span>
      )}
    </div>
  );
}

interface MoveFormState {
  new_date: string;
  new_time_slot_id: string;
  new_classroom_id: string;
  new_prof_id: string;
  notes: string;
  effective_until: string;
}

interface OccurrenceDialogProps {
  occ: Occurrence;
  mode: DialogMode;
  onClose: () => void;
  onChangeMode: (mode: DialogMode) => void;
  timeSlots: { id: string; label: string; day_of_week: number; start_time: string; end_time: string }[];
  professors: { id: string; full_name: string }[];
  classrooms: { id: string; name: string }[];
}

function OccurrenceDialog({ occ, mode, onClose, onChangeMode, timeSlots, professors, classrooms }: OccurrenceDialogProps) {
  const { t } = useTranslation();
  const createException = useCreateEntryException();
  const removeException = useRemoveEntryException();
  const splitEntry = useSplitEntry();
  const endSeries = useEndEntrySeries();

  const [error, setError] = useState("");
  const [form, setForm] = useState<MoveFormState>({ new_date: occ.date, new_time_slot_id: "", new_classroom_id: "", new_prof_id: "", notes: "", effective_until: "" });

  const actionDate = occ.movedFrom?.date ?? occ.date;
  const exception: ScheduleEntryException | null = occ.exception ?? null;

  const submit = (payload: { exception_type: "cancelled" | "moved" | "substitute_prof" | "room_change"; occurrence_date: string; new_date?: string; new_time_slot_id?: string; new_classroom_id?: string; new_prof_id?: string; notes?: string }) => {
    createException.mutate({ entryId: occ.scheduleEntryId, data: { ...payload, occurrence_date: actionDate } }, {
      onSuccess: () => onClose(),
      onError: (err) => setError(apiError(err, t("common.error", "Something went wrong"))),
    });
  };

  const submitSplit = () => {
    splitEntry.mutate({
      entryId: occ.scheduleEntryId,
      data: {
        from_date: actionDate,
        time_slot_id: form.new_time_slot_id || undefined,
        classroom_id: form.new_classroom_id ? form.new_classroom_id : undefined,
        prof_id: form.new_prof_id || undefined,
        notes: form.notes || undefined,
        effective_until: form.effective_until || null,
      },
    }, {
      onSuccess: () => onClose(),
      onError: (err) => setError(apiError(err, t("common.error", "Something went wrong"))),
    });
  };

  const submitEnd = () => {
    endSeries.mutate({ entryId: occ.scheduleEntryId, fromDate: actionDate }, {
      onSuccess: () => onClose(),
      onError: (err) => setError(apiError(err, t("common.error", "Something went wrong"))),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-modal shadow-hover p-5 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: occ.color ?? occ.group.color ?? "#0ea5e9" }} />
              <h3 className="text-h4 font-bold truncate">{occ.group.name}</h3>
            </div>
            <p className="text-xs text-text-secondary mt-0.5">
              {DAY_NAMES[(new Date(occ.date + "T00:00:00Z").getUTCDay() + 6) % 7]} {occ.date} · {occ.start_time.slice(0, 5)}–{occ.end_time.slice(0, 5)}
            </p>
          </div>
          <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:bg-black/5 dark:hover:bg-white/10" aria-label={t("common.close", "Close")}>
            <X size={16} />
          </button>
        </div>

        {/*
          Labels styled like the column headers in the list views — small,
          uppercase, tracked — so a record reads the same whether it is seen as
          a table row or opened on its own.
        */}
        <dl className="rounded-card border border-border divide-y divide-border mb-4">
          <DetailRow label={t("scheduling.subject", "Matière")}>
            {occ.group.field?.name ?? "—"}
          </DetailRow>
          <DetailRow label={t("fieldsHierarchy.professor", "Professeur")}>
            {occ.professor?.full_name ?? "—"}
          </DetailRow>
          <DetailRow label={t("nav.classrooms", "Salle")}>
            {occ.classroom
              ? `${occ.classroom.name}${occ.classroom.room_number ? ` · ${occ.classroom.room_number}` : ""}`
              : "—"}
          </DetailRow>
          <DetailRow label={t("scheduling.status", "Statut")}>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                STATUS_TONE[occ.status] ?? "bg-neutral-soft text-text-secondary"
              }`}
            >
              {STATUS_LABEL[occ.status] ?? occ.status}
            </span>
          </DetailRow>
          {occ.movedFrom && (
            <DetailRow label={t("scheduling.movedFrom", "Déplacée depuis")}>
              {occ.movedFrom.date} · {occ.movedFrom.start_time.slice(0, 5)}
            </DetailRow>
          )}
          {exception?.notes && (
            <DetailRow label={t("scheduling.notes", "Notes")}>
              <span className="break-words">{exception.notes}</span>
            </DetailRow>
          )}
        </dl>

        {error && <div className="rounded-btn border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger mb-4">{error}</div>}

        {mode === "view" && (
          <div className="space-y-4">
            {/*
              Split by blast radius. The six actions used to sit in one
              undifferentiated block, so "move this Tuesday" and "end every
              future session" looked equally reversible.
            */}
            <section>
              <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                {t("scheduling.thisSession", "Cette séance uniquement")}
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {occ.status !== "cancelled" && occ.status !== "student_cancelled" && (
                  <button className="btn btn-secondary text-xs justify-start" onClick={() => onChangeMode("cancel")}>
                    <Ban size={13} /> {t("scheduling.cancelOccurrence", "Annuler")}
                  </button>
                )}
                <button className="btn btn-secondary text-xs justify-start" onClick={() => onChangeMode("move")}>
                  <ArrowLeftRight size={13} /> {t("scheduling.move", "Déplacer")}
                </button>
                <button className="btn btn-secondary text-xs justify-start" onClick={() => onChangeMode("substitute")}>
                  <UserX size={13} /> {t("scheduling.substitute", "Remplacer")}
                </button>
                <button className="btn btn-secondary text-xs justify-start" onClick={() => onChangeMode("room")}>
                  <DoorOpen size={13} /> {t("scheduling.roomChange", "Changer de salle")}
                </button>
              </div>
            </section>

            <section className="pt-3 border-t border-border">
              <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                {t("scheduling.wholeSeries", "Cette séance et les suivantes")}
              </h4>
              <div className="space-y-2">
                <button className="btn btn-secondary text-xs w-full justify-start" onClick={() => onChangeMode("split")}>
                  <Slice size={13} /> {t("scheduling.editSeries", "Modifier la série")}
                </button>
                <button className="btn btn-secondary text-xs w-full justify-start !text-danger hover:!bg-danger-soft" onClick={() => onChangeMode("end")}>
                  <Layers size={13} /> {t("scheduling.endSeries", "Terminer la série")}
                </button>
              </div>
            </section>

            {exception && (
              <section className="pt-3 border-t border-border">
                <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                  {t("scheduling.exception", "Exception appliquée")}
                </h4>
                <button
                  className="btn btn-secondary text-xs w-full justify-start"
                  onClick={() => removeException.mutate(exception.id, { onSuccess: onClose, onError: (err) => setError(apiError(err, t("common.error", "Une erreur est survenue"))) })}
                >
                  <RotateCcw size={13} /> {t("scheduling.removeException", "Rétablir la séance d'origine")}
                </button>
              </section>
            )}
          </div>
        )}

        {mode === "cancel" && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">{t("scheduling.cancelConfirm", "The whole class skips this session. The rule keeps recurring — only this date is cancelled.")}</p>
            <div className="flex gap-3 justify-end">
              <button className="btn btn-secondary" onClick={onClose}>{t("common.back", "Back")}</button>
              <FormButton className="btn btn-danger" isLoading={createException.isPending} onClick={() => submit({ exception_type: "cancelled", occurrence_date: actionDate })}>
                {t("scheduling.cancelOccurrence", "Cancel")}
              </FormButton>
            </div>
          </div>
        )}

        {mode === "move" && (
          <MoveForm
            form={form} setForm={setForm} timeSlots={timeSlots} classrooms={classrooms} professors={professors}
            pending={createException.isPending}
            onBack={() => onChangeMode("view")}
            onSubmit={() => submit({
              exception_type: "moved",
              occurrence_date: actionDate,
              new_date: form.new_date,
              new_time_slot_id: form.new_time_slot_id || undefined,
              new_classroom_id: form.new_classroom_id || undefined,
              new_prof_id: form.new_prof_id || undefined,
              notes: form.notes || undefined,
            })}
          />
        )}

        {mode === "substitute" && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t("scheduling.newProfessor", "Replacement professor")} *</label>
              <select value={form.new_prof_id} onChange={(e) => setForm((f) => ({ ...f, new_prof_id: e.target.value }))} className="input text-sm">
                <option value="">{t("students.selectProfessor", "Select professor")}</option>
                {professors.filter((p) => p.id !== occ.professor?.id).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
            <NotesField notes={form.notes} onChange={(v) => setForm((f) => ({ ...f, notes: v }))} />
            <div className="flex gap-3 justify-end">
              <button className="btn btn-secondary" onClick={() => onChangeMode("view")}>{t("common.back", "Back")}</button>
              <FormButton className="btn btn-primary" isLoading={createException.isPending} disabled={!form.new_prof_id}
                onClick={() => submit({ exception_type: "substitute_prof", occurrence_date: actionDate, new_prof_id: form.new_prof_id, notes: form.notes || undefined })}>
                {t("common.save", "Save")}
              </FormButton>
            </div>
          </div>
        )}

        {mode === "room" && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t("scheduling.newClassroom", "New classroom")} *</label>
              <select value={form.new_classroom_id} onChange={(e) => setForm((f) => ({ ...f, new_classroom_id: e.target.value }))} className="input text-sm">
                <option value="">{t("scheduling.selectClassroom", "Select classroom")}</option>
                {classrooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <NotesField notes={form.notes} onChange={(v) => setForm((f) => ({ ...f, notes: v }))} />
            <div className="flex gap-3 justify-end">
              <button className="btn btn-secondary" onClick={() => onChangeMode("view")}>{t("common.back", "Back")}</button>
              <FormButton className="btn btn-primary" isLoading={createException.isPending} disabled={!form.new_classroom_id}
                onClick={() => submit({ exception_type: "room_change", occurrence_date: actionDate, new_classroom_id: form.new_classroom_id, notes: form.notes || undefined })}>
                {t("common.save", "Save")}
              </FormButton>
            </div>
          </div>
        )}

        {mode === "split" && (
          <div className="space-y-3">
            <p className="text-xs text-text-secondary">{t("scheduling.splitHint", "From this date on, the rule is replaced with the values below. Anything before stays untouched.")}</p>
            <div>
              <label className="block text-sm font-medium mb-1">{t("scheduling.from", "From")}</label>
              <input type="date" value={actionDate} disabled className="input text-sm bg-neutral-soft dark:bg-white/5" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("nav.timeSlots", "Time slot")}</label>
              <select value={form.new_time_slot_id} onChange={(e) => setForm((f) => ({ ...f, new_time_slot_id: e.target.value }))} className="input text-sm">
                <option value="">{t("scheduling.keepCurrent", "Keep current")}</option>
                {timeSlots.map((ts) => <option key={ts.id} value={ts.id}>{DAY_NAMES[ts.day_of_week] ?? "?"} {ts.start_time}–{ts.end_time}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.professor", "Professor")}</label>
              <select value={form.new_prof_id} onChange={(e) => setForm((f) => ({ ...f, new_prof_id: e.target.value }))} className="input text-sm">
                <option value="">{t("scheduling.keepCurrent", "Keep current")}</option>
                {professors.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("nav.classrooms", "Classroom")}</label>
              <select value={form.new_classroom_id} onChange={(e) => setForm((f) => ({ ...f, new_classroom_id: e.target.value }))} className="input text-sm">
                <option value="">{t("scheduling.keepCurrent", "Keep current")}</option>
                {classrooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {/*
              No subject input: a session's subject is the group's academic
              field, which comes from the hierarchy and cannot be typed over
              here without the two disagreeing.
            */}
            <div>
              <label className="block text-sm font-medium mb-1">{t("scheduling.until", "Jusqu'au")}</label>
              <input type="date" value={form.effective_until} onChange={(e) => setForm((f) => ({ ...f, effective_until: e.target.value }))} className="input text-sm" />
            </div>
            <div className="flex gap-3 justify-end">
              <button className="btn btn-secondary" onClick={() => onChangeMode("view")}>{t("common.back", "Back")}</button>
              <FormButton className="btn btn-primary" isLoading={splitEntry.isPending} onClick={submitSplit}>
                {t("common.save", "Save")}
              </FormButton>
            </div>
          </div>
        )}

        {mode === "end" && (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">{t("scheduling.endConfirm", "This date and every following occurrence of this rule stop existing. Earlier sessions stay as they are.")}</p>
            <div className="flex gap-3 justify-end">
              <button className="btn btn-secondary" onClick={() => onChangeMode("view")}>{t("common.back", "Back")}</button>
              <FormButton className="btn btn-danger" isLoading={endSeries.isPending} onClick={submitEnd}>
                {t("scheduling.endSeries", "End series")}
              </FormButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MoveForm({ form, setForm, timeSlots, classrooms, professors, pending, onBack, onSubmit }: {
  form: MoveFormState;
  setForm: (updater: (f: MoveFormState) => MoveFormState) => void;
  timeSlots: { id: string; label: string; day_of_week: number; start_time: string; end_time: string }[];
  classrooms: { id: string; name: string }[];
  professors: { id: string; full_name: string }[];
  pending: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium mb-1">{t("scheduling.newDate", "New date")} *</label>
        <input type="date" value={form.new_date} onChange={(e) => setForm((f) => ({ ...f, new_date: e.target.value }))} className="input text-sm" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">{t("nav.timeSlots", "Time slot")} *</label>
        <select value={form.new_time_slot_id} onChange={(e) => setForm((f) => ({ ...f, new_time_slot_id: e.target.value }))} className="input text-sm">
          <option value="">{t("scheduling.selectTimeSlot", "Select time slot")}</option>
          {timeSlots.map((ts) => <option key={ts.id} value={ts.id}>{DAY_NAMES[ts.day_of_week] ?? "?"} {ts.start_time}–{ts.end_time}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">{t("nav.classrooms", "Classroom")}</label>
        <select value={form.new_classroom_id} onChange={(e) => setForm((f) => ({ ...f, new_classroom_id: e.target.value }))} className="input text-sm">
          <option value="">{t("scheduling.noClassroom", "No classroom")}</option>
          {classrooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">{t("fieldsHierarchy.professor", "Professor")}</label>
        <select value={form.new_prof_id} onChange={(e) => setForm((f) => ({ ...f, new_prof_id: e.target.value }))} className="input text-sm">
          <option value="">{t("scheduling.keepCurrent", "Keep current")}</option>
          {professors.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
      </div>
      <NotesField notes={form.notes} onChange={(v) => setForm((f) => ({ ...f, notes: v }))} />
      <div className="flex gap-3 justify-end">
        <button className="btn btn-secondary" onClick={onBack}>{t("common.back", "Back")}</button>
        <FormButton className="btn btn-primary" isLoading={pending} disabled={!form.new_date || !form.new_time_slot_id} onClick={onSubmit}>
          {t("common.save", "Save")}
        </FormButton>
      </div>
    </div>
  );
}

function NotesField({ notes, onChange }: { notes: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{t("scheduling.notes", "Notes")}</label>
      <textarea value={notes} onChange={(e) => onChange(e.target.value)} rows={2} maxLength={500} className="input text-sm resize-none" />
    </div>
  );
}