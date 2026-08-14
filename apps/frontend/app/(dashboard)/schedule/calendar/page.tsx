"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Search, CalendarDays, CalendarClock, CalendarRange, ChevronLeft, ChevronRight, Plus, X, ArrowLeftRight, UserX, DoorOpen, Layers, Ban, Slice, SlidersHorizontal, RotateCcw } from "lucide-react";
import type FullCalendarType from "@fullcalendar/react";
import { useOccurrences, useCreateEntryException, useRemoveEntryException, useSplitEntry, useEndEntrySeries } from "@/hooks/use-scheduling";
import { useProfessors, useGroups } from "@/hooks/use-queries";
import { useClassrooms, useWorkingHours } from "@/hooks/use-scheduling";
import { readableTextColor } from "@/lib/utils/colors";
import { ClassroomPicker } from "@/components/scheduling/classroom-picker";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { FormButton } from "@/components/forms/form-helpers";
import { PageLoader } from "@/components/shared/skeletons";

import { useTranslation } from "@/lib/i18n/context";
import type { Occurrence, ScheduleEntryException } from "@/types";

const DAY_NAMES = ["Sam", "Dim", "Lun", "Mar", "Mer", "Jeu", "Ven"];

/**
 * `DAY_NAMES` is indexed by the school weekday (0=Sat), not by `getUTCDay`.
 *
 * Rotating a JS day into that index is `+ 1`, not the `+ 6` that converts the
 * other way — the wrong one reads as plausible and is wrong on all seven days,
 * which is how this label spent its life two days out.
 */
function dayLabel(date: string): string {
  return DAY_NAMES[(new Date(date + "T00:00:00Z").getUTCDay() + 1) % 7];
}

/** The calendar grid starts on Saturday — the Tunisian school week. */
const FIRST_DAY = 6;

type CalendarView = "dayGridMonth" | "timeGridWeek" | "timeGridDay";

/**
 * The three views, as one segmented control.
 *
 * Day is added because a school day is the unit an administrator actually works
 * in when placing a session; month and week alone force a choice between "too
 * coarse to read" and "too wide to act on".
 */
const VIEW_OPTIONS: { value: CalendarView; labelKey: string; fallback: string; icon: typeof CalendarDays }[] = [
  { value: "timeGridDay", labelKey: "scheduling.day", fallback: "Jour", icon: CalendarClock },
  { value: "timeGridWeek", labelKey: "scheduling.week", fallback: "Semaine", icon: CalendarRange },
  { value: "dayGridMonth", labelKey: "scheduling.month", fallback: "Mois", icon: CalendarDays },
];

/** `HH:MM` — Postgres `time` columns arrive as `HH:MM:SS`. */
function hhmm(time: string): string {
  return String(time).slice(0, 5);
}

/**
 * School weekday (0=Sat) → FullCalendar's weekday (0=Sun).
 *
 * This is the forward rotation, `+ 6`, matching `isoDayOfWeek` on the backend.
 * The inverse is `+ 1`, not `+ 6` again — see `scheduling/date.util.ts`.
 */
function isoDayFromSchoolDay(day: number): number {
  return (day + 6) % 7;
}

/**
 * FullCalendar and its three plugins are ~250 KB of JavaScript that only this
 * route renders. Imported statically they were parsed on every dashboard page,
 * including the ones a user visits far more often; loaded here they cost
 * nothing until the calendar is actually opened.
 *
 * `ssr: false` because the library reads `window` while measuring the grid.
 *
 * The calendar instance comes back through `innerRef`, not `ref`, and it has to:
 * `next/dynamic` binds the `ref` it is given to its own imperative handle
 * (`{ retry }`) and renders the loaded component with props alone, so a `ref`
 * put on this component never reaches FullCalendar — it silently resolves to
 * the loader's retry object instead, and the first `getApi()` call on it throws.
 * A plain prop passes straight through.
 */
const FullCalendar = dynamic(
  async () => {
    const [{ default: Calendar }, dayGrid, timeGrid, interaction] = await Promise.all([
      import("@fullcalendar/react"),
      import("@fullcalendar/daygrid"),
      import("@fullcalendar/timegrid"),
      import("@fullcalendar/interaction"),
    ]);
    const plugins = [dayGrid.default, timeGrid.default, interaction.default];
    // The plugin list is fixed, so it is baked in here rather than threaded
    // through props — the loader is the only place that has the modules.
    const WithPlugins = ({ innerRef, ...props }: { innerRef?: React.Ref<FullCalendarType> } & Record<string, unknown>) => (
      <Calendar ref={innerRef} plugins={plugins} {...props} />
    );
    WithPlugins.displayName = "FullCalendarWithPlugins";
    return WithPlugins;
  },
  { ssr: false, loading: () => <div className="h-[600px] animate-pulse rounded bg-neutral-soft dark:bg-white/10" /> },
) as unknown as React.ComponentType<{ innerRef?: React.Ref<FullCalendarType> } & Record<string, unknown>>;

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

/**
 * The window a month view actually shows, which is not the month.
 *
 * FullCalendar's month grid is six fixed weeks starting on `firstDay`, so it
 * reports a range running from the Saturday before the 1st to well past the
 * end. Seeding the state with the calendar month instead meant the first
 * request asked for one range and `datesSet` immediately asked for another —
 * two full expansions of every recurring rule, a megabyte each, on every visit
 * to this page. `datesSet` still has the last word; this only makes its first
 * answer the one already in flight.
 */
function monthGridRange(reference: Date): { from: string; to: string } {
  const first = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const lead = (first.getDay() - FIRST_DAY + 7) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - lead);
  // `datesSet` reports an exclusive end, so the range covers 6 × 7 days.
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42);
  return { from: iso(start), to: iso(end) };
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
  const { t } = useTranslation();
  return (
    <Suspense fallback={<PageLoader text={t("common.loading")} />}>
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

  const { data: workingHours } = useWorkingHours();

  const [range, setRange] = useState<{ from: string; to: string }>(() => monthGridRange(new Date()));
  const [view, setView] = useState<CalendarView>("dayGridMonth");
  /** The period label and today-state come from the grid, which owns the dates. */
  const [periodTitle, setPeriodTitle] = useState("");
  const [isOnToday, setIsOnToday] = useState(true);
  const [filters, setFilters] = useState<{ groupId?: string; profId?: string; classroomId?: string; search?: string }>(() => ({
    groupId: searchParams.get("groupId") ?? undefined,
    profId: searchParams.get("profId") ?? undefined,
    classroomId: searchParams.get("classroomId") ?? undefined,
  }));
  const [dialog, setDialog] = useState<{ occ: Occurrence; mode: DialogMode } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const calendarRef = useRef<FullCalendarType | null>(null);

  useEffect(() => {
    calendarRef.current?.getApi().changeView(view);
  }, [view]);

  /**
   * Narrow screens open on the day.
   *
   * A seven-column week grid at phone width gives each day about 40px, which is
   * too narrow for a group name — and a month cell too narrow for anything at
   * all. The day view is the same data at a usable density. Applied once, on
   * mount, so it is a sensible default rather than a rule that fights the
   * operator every time they rotate the device or pick another view.
   */
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches) {
      setView("timeGridDay");
    }
  }, []);

  // Each occurrence request re-expands every recurring rule over the visible
  // range, so the search term is debounced rather than sent per keystroke.
  const debouncedSearch = useDebouncedValue(filters.search ?? "", 300);
  const { data: occurrences, isLoading } = useOccurrences({
    ...range,
    ...filters,
    search: debouncedSearch || undefined,
  });

  const handleDatesSet = useCallback((info: any) => {
    const next = { from: iso(info.start), to: iso(info.end) };
    // Only re-fetch when the visible window really moved. The seeded range
    // normally matches what the grid reports on mount, and setting identical
    // state would still re-render the calendar on every view change.
    setRange((prev) => (prev.from === next.from && prev.to === next.to ? prev : next));

    // The header shows the period and disables "Today" when already on it.
    // Both are read from the view rather than recomputed, so they cannot
    // disagree with what the grid is actually showing.
    setPeriodTitle(info.view?.title ?? "");
    const now = new Date();
    setIsOnToday(now >= info.start && now < info.end);
  }, []);

  const events = useMemo(() => (occurrences ?? []).map(toEvent), [occurrences]);

  /**
   * Visible time bounds, from the school's declared opening hours.
   *
   * Padded by an hour on each side so a session that runs slightly over is
   * still reachable, and clamped to whole hours. Falls back to the previous
   * hard-coded window when no hours are configured.
   */
  const slotBounds = useMemo(() => {
    const pad = (time: string, hours: number) => {
      const h = Math.min(24, Math.max(0, Number(time.slice(0, 2)) + hours));
      return `${String(h).padStart(2, "0")}:00:00`;
    };

    let min = "23:59";
    let max = "00:00";
    for (const w of workingHours ?? []) {
      if (hhmm(w.start_time) < min) min = hhmm(w.start_time);
      if (hhmm(w.end_time) > max) max = hhmm(w.end_time);
    }

    /**
     * The sessions on screen widen the window too.
     *
     * Deriving the bounds from the opening hours alone would clip a session
     * that sits outside them — exactly the sessions an administrator most needs
     * to find, since they are the ones to move. A rule created before the hours
     * were declared, or an evening make-up, would simply not be drawn, and the
     * grid would look empty while the header counted the session.
     */
    for (const occ of occurrences ?? []) {
      const start = hhmm(occ.start_time);
      const end = hhmm(occ.end_time);
      if (start < min) min = start;
      if (end > max) max = end;
    }

    if (min > max) return { min: "07:00:00", max: "21:00:00" };
    return { min: pad(min, -1), max: pad(max, 1) };
  }, [workingHours, occurrences]);

  /**
   * The shaded opening hours, per weekday.
   *
   * FullCalendar counts days from Sunday, so the school's Saturday-first
   * numbering is rotated on the way in. A row with no `day_of_week` is the
   * every-day default and applies to all seven.
   */
  const businessHours = useMemo(() => {
    if (!workingHours?.length) return false as const;
    const active = workingHours.filter((w) => w.is_active !== false);
    const specificDays = new Set(active.filter((w) => w.day_of_week != null).map((w) => w.day_of_week));
    return active.map((w) => ({
      daysOfWeek:
        w.day_of_week == null
          ? // Defaults cover every day the school has not overridden.
            [0, 1, 2, 3, 4, 5, 6].filter((js) => !specificDays.has((js + 1) % 7))
          : [isoDayFromSchoolDay(w.day_of_week)],
      startTime: hhmm(w.start_time),
      endTime: hhmm(w.end_time),
    }));
  }, [workingHours]);

  /** Long day names have room in a day view; a week needs the short form. */
  const dayHeaderFormat = useMemo(
    () =>
      view === "timeGridDay"
        ? ({ weekday: "long", day: "numeric", month: "short" } as const)
        : view === "timeGridWeek"
          ? ({ weekday: "short", day: "numeric" } as const)
          : ({ weekday: "short" } as const),
    [view],
  );

  const hasActiveFilters = Boolean(filters.groupId || filters.profId || filters.classroomId || filters.search);

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
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-h4 font-bold text-text-primary">{t("nav.scheduleCalendar", "Emploi du temps")}</h2>
          <p className="text-xs text-text-secondary mt-1">{t("scheduling.calendarSubtitle", "Every concrete session of every rule — click one to cancel, move, substitute, or edit its series.")}</p>
        </div>
        {/* The primary action, where a scheduling tool puts it. Sessions are
            created against a group, so this hands off to the timetable builder
            rather than duplicating that form here. */}
        <Link href="/schedule/entries" className="btn btn-primary text-xs shrink-0">
          <Plus size={15} aria-hidden="true" />
          {t("scheduling.newSession", "Nouvelle séance")}
        </Link>
      </div>

      {/*
        One toolbar: period, navigation, view, filters. These used to be split
        between a page header (the view buttons), a filter strip and
        FullCalendar's own toolbar (prev/next/today, in the library's typeface),
        so the three controls that move the calendar were in three places and
        only one of them looked like the rest of the app.
      */}
      <div className="card !p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => calendarRef.current?.getApi().prev()}
              className="h-8 w-8 inline-flex items-center justify-center rounded-btn border border-border text-text-secondary transition-colors hover:bg-background hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              aria-label={t("common.previous", "Précédent")}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => calendarRef.current?.getApi().next()}
              className="h-8 w-8 inline-flex items-center justify-center rounded-btn border border-border text-text-secondary transition-colors hover:bg-background hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              aria-label={t("common.next", "Suivant")}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => calendarRef.current?.getApi().today()}
              disabled={isOnToday}
              className="h-8 px-3 inline-flex items-center rounded-btn border border-border text-xs font-medium text-text-secondary transition-colors hover:bg-background hover:text-text-primary disabled:opacity-50 disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              {t("scheduling.today", "Aujourd'hui")}
            </button>
          </div>

          {/* The period being looked at, as the largest thing in the bar. */}
          <h3 className="text-sm font-semibold text-text-primary first-letter:uppercase min-w-0 truncate" aria-live="polite">
            {periodTitle}
          </h3>

          <div className="ml-auto flex items-center gap-2">
            {/* Segmented control: one control with three states reads as a
                choice, where three buttons read as three actions. */}
            <div className="inline-flex rounded-btn border border-border p-0.5" role="group" aria-label={t("scheduling.view", "Vue")}>
              {VIEW_OPTIONS.map((option) => {
                const active = view === option.value;
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setView(option.value)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 rounded-[7px] px-2.5 h-7 text-xs font-medium transition-colors ${
                      active
                        ? "bg-primary text-white"
                        : "text-text-secondary hover:bg-background hover:text-text-primary"
                    }`}
                  >
                    <Icon size={13} aria-hidden="true" />
                    <span className="hidden sm:inline">{t(option.labelKey, option.fallback)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/*
          Search and filters share the toolbar rather than owning a strip of
          their own. The selects stay behind a toggle; what is actually
          narrowing the view stays visible as chips, so an accidentally-left
          filter cannot silently hide half the timetable.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
            <input
              type="text"
              placeholder={t("scheduling.searchPlaceholder", "Groupe, professeur ou étudiant…")}
              value={filters.search ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value || undefined }))}
              className="input pl-9 w-full text-xs"
              aria-label={t("scheduling.searchPlaceholder", "Rechercher")}
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            aria-expanded={showFilters}
            className={`btn text-xs ${activeFilterCount > 0 ? "btn-primary" : "btn-secondary"}`}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            <span className="hidden sm:inline">{t("common.filters", "Filtres")}</span>
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-white/25 px-1 text-[10px] font-semibold tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </button>
          <span className="ml-auto text-xs text-text-secondary tabular-nums whitespace-nowrap">
            {isLoading ? "…" : occurrences?.length ?? 0} {t("scheduling.sessions", "séance(s)")}
          </span>
        </div>

        {showFilters && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
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

      {/*
        The grid stays mounted through loading and empty states.
        Replacing it with a spinner or an empty panel unmounted FullCalendar
        entirely, so a filter that matched nothing took the navigation away with
        it — leaving no way to step to a month that did have sessions. Both
        states are overlaid instead.
      */}
      <div className="card overflow-hidden !p-0 relative">
        <div className="calendar-shell p-2 sm:p-3">
          <FullCalendar
            innerRef={calendarRef}
            initialView={view}
            datesSet={handleDatesSet}
            events={events}
            eventClick={selectOccurrence}
            firstDay={FIRST_DAY}
            height="auto"
            headerToolbar={false}
            // The school's declared opening hours, not a hard-coded 07:00–21:00.
            // A school that starts at 08:00 was showing an hour of dead grid;
            // one running an evening session had it clipped off the bottom.
            slotMinTime={slotBounds.min}
            slotMaxTime={slotBounds.max}
            businessHours={businessHours}
            nowIndicator
            slotDuration="00:30:00"
            slotLabelInterval="01:00"
            slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
            eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
            dayHeaderFormat={dayHeaderFormat}
            allDaySlot={false}
            expandRows
            stickyHeaderDates
            dayMaxEvents={view === "dayGridMonth" ? 3 : false}
            eventDisplay="block"
            eventContent={EventContent}
            locale="fr"
            firstHour={8}
          />
        </div>

        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/70 backdrop-blur-[1px]">
            <PageLoader text={t("common.loading", "Chargement…")} />
          </div>
        )}

        {!isLoading && occurrences?.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center pt-24">
            <div className="pointer-events-auto mx-4 max-w-sm rounded-card border border-border bg-surface/95 px-6 py-5 text-center shadow-card backdrop-blur-[1px]">
              <CalendarDays size={22} className="mx-auto mb-2 text-text-secondary" aria-hidden="true" />
              <p className="text-sm font-medium text-text-primary">
                {hasActiveFilters
                  ? t("scheduling.noOccurrencesFiltered", "Aucune séance ne correspond à ces filtres.")
                  : t("scheduling.noOccurrences", "Aucune séance sur cette période.")}
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                {hasActiveFilters
                  ? t("scheduling.tryClearingFilters", "Élargissez la recherche ou changez de période.")
                  : t("scheduling.createFirstSession", "Créez une séance ou naviguez vers une autre période.")}
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                {hasActiveFilters ? (
                  <button type="button" onClick={() => setFilters({})} className="btn btn-secondary text-xs">
                    {t("common.clearAll", "Tout effacer")}
                  </button>
                ) : (
                  <Link href="/schedule/entries" className="btn btn-primary text-xs">
                    <Plus size={14} aria-hidden="true" />
                    {t("scheduling.newSession", "Nouvelle séance")}
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {dialog && (
        <OccurrenceDialog
          occ={dialog.occ}
          mode={dialog.mode}
          onClose={() => setDialog(null)}
          onChangeMode={(mode) => setDialog((d) => (d ? { ...d, mode } : d))}

          professors={professors ?? []}
          classrooms={classrooms ?? []}
        />
      )}
    </div>
  );
}

/** Grey for a session that is no longer happening. */
const CANCELLED_TONE = "#94A3B8";

/**
 * The colour a session is drawn in.
 *
 * The room comes first: a timetable is read by where things are, and the room
 * is the resource being allocated, so it is the useful identity to carry into
 * the grid. Groups that have no room fall back to their own colour, then to a
 * default, so a session is never colourless.
 */
function occurrenceColor(occ: Occurrence): string {
  if (occ.status === "cancelled" || occ.status === "student_cancelled") return CANCELLED_TONE;
  return occ.classroom?.color ?? occ.color ?? occ.group.color ?? "#0EA5E9";
}

function toEvent(occ: Occurrence) {
  const color = occurrenceColor(occ);
  return {
    id: occ.occurrenceId,
    title: `${occ.group.name} · ${occ.professor?.full_name ?? ""}`,
    start: `${occ.date}T${occ.start_time}`,
    end: `${occ.date}T${occ.end_time}`,
    backgroundColor: color,
    borderColor: color,
    // Chosen against the colour rather than assumed white: the palette includes
    // yellows and ambers on which white text sits far below 4.5:1.
    textColor: readableTextColor(color),
    extendedProps: { occ },
  };
}

/**
 * One session in the grid.
 *
 * Information is added as the tile gets taller rather than shrunk to fit: a
 * 30-minute slot shows the group and the time, an hour adds the subject and the
 * room, and anything longer adds the professor. The alternative — rendering
 * every field always — is what makes short sessions in a week view an
 * unreadable stack of clipped 9px lines.
 *
 * The measurement is the event's own duration, not a DOM read, so it costs
 * nothing and cannot thrash layout while the grid is scrolling.
 */
function EventContent(info: any) {
  const occ = info.event.extendedProps.occ as Occurrence;
  const cancelled = occ.status === "cancelled" || occ.status === "student_cancelled";
  const background = occurrenceColor(occ);
  const foreground = readableTextColor(background);
  const isMonthView = info.view?.type === "dayGridMonth";

  const minutes =
    (Date.parse(`1970-01-01T${occ.end_time}`) - Date.parse(`1970-01-01T${occ.start_time}`)) / 60000;
  const showSubject = !isMonthView && minutes >= 50;
  const showProfessor = !isMonthView && minutes >= 75;
  const showRoom = !isMonthView && minutes >= 50;

  const tooltip = [
    occ.group.name + (occ.group.field ? ` · ${occ.group.field.name}` : ""),
    `${occ.start_time.slice(0, 5)}–${occ.end_time.slice(0, 5)}`,
    occ.professor?.full_name ?? "",
    occ.classroom ? `${occ.classroom.name}${occ.classroom.room_number ? ` (${occ.classroom.room_number})` : ""}` : "",
    occ.status !== "normal" ? (STATUS_LABEL[occ.status] ?? occ.status) : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      className="group/event flex h-full w-full flex-col gap-px overflow-hidden rounded-lg px-1.5 py-1 cursor-pointer transition-[filter,box-shadow] duration-150 hover:brightness-[1.06] hover:shadow-card"
      style={{ backgroundColor: background, color: foreground }}
      title={tooltip}
    >
      {/* The month grid gives a tile one line, so the time leads there — it is
          what distinguishes two sessions of the same group on one day. */}
      <span className={`flex items-baseline gap-1 text-[11px] font-semibold leading-tight ${cancelled ? "line-through" : ""}`}>
        {isMonthView && (
          <span className="shrink-0 tabular-nums opacity-90">{occ.start_time.slice(0, 5)}</span>
        )}
        <span className="truncate">{occ.group.name}</span>
      </span>

      {!isMonthView && (
        <span className="shrink-0 text-[10px] leading-tight tabular-nums opacity-90">
          {occ.start_time.slice(0, 5)}–{occ.end_time.slice(0, 5)}
        </span>
      )}

      {showSubject && occ.group.field && (
        <span className="truncate text-[10px] font-medium leading-tight opacity-95">{occ.group.field.name}</span>
      )}

      {showRoom && occ.classroom && (
        <span className="flex items-center gap-1 truncate text-[10px] leading-tight opacity-90">
          <DoorOpen size={9} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{occ.classroom.name}</span>
        </span>
      )}

      {showProfessor && occ.professor && (
        <span className="truncate text-[10px] leading-tight opacity-80">{occ.professor.full_name}</span>
      )}

      {occ.status !== "normal" && (
        <span
          className="mt-auto inline-flex w-fit shrink-0 rounded px-1 text-[9px] font-semibold uppercase leading-[14px] tracking-wide"
          style={{ backgroundColor: foreground === "#FFFFFF" ? "rgb(0 0 0 / 0.28)" : "rgb(255 255 255 / 0.45)" }}
        >
          {STATUS_LABEL[occ.status] ?? occ.status}
        </span>
      )}
    </div>
  );
}

interface MoveFormState {
  new_date: string;
  /** The window, typed. Replaces the old `new_time_slot_id` dropdown. */
  new_start_time: string;
  new_end_time: string;
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

  professors: { id: string; full_name: string }[];
  classrooms: { id: string; name: string }[];
}

function OccurrenceDialog({ occ, mode, onClose, onChangeMode, professors, classrooms }: OccurrenceDialogProps) {
  const { t } = useTranslation();
  const createException = useCreateEntryException();
  const removeException = useRemoveEntryException();
  const splitEntry = useSplitEntry();
  const endSeries = useEndEntrySeries();

  const [error, setError] = useState("");
  // Seeded with the session's own window so "move to another day, same time" —
  // the common case — needs only the date changed.
  const [form, setForm] = useState<MoveFormState>({
    new_date: occ.date,
    new_start_time: occ.start_time.slice(0, 5),
    new_end_time: occ.end_time.slice(0, 5),
    new_classroom_id: "",
    new_prof_id: "",
    notes: "",
    effective_until: "",
  });

  const actionDate = occ.movedFrom?.date ?? occ.date;
  const exception: ScheduleEntryException | null = occ.exception ?? null;

  const submit = (payload: { exception_type: "cancelled" | "moved" | "substitute_prof" | "room_change"; occurrence_date: string; new_date?: string; new_start_time?: string; new_end_time?: string; new_classroom_id?: string; new_prof_id?: string; notes?: string }) => {
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
        // Both or neither: a half-filled window is not a window, and leaving
        // them blank means "keep the current one".
        start_time: form.new_start_time && form.new_end_time ? form.new_start_time : undefined,
        end_time: form.new_start_time && form.new_end_time ? form.new_end_time : undefined,
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
              {dayLabel(occ.date)} {occ.date} · {occ.start_time.slice(0, 5)}–{occ.end_time.slice(0, 5)}
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
            form={form} setForm={setForm} classrooms={classrooms} professors={professors}
            entryId={occ.scheduleEntryId}
            pending={createException.isPending}
            onBack={() => onChangeMode("view")}
            onSubmit={() => submit({
              exception_type: "moved",
              occurrence_date: actionDate,
              new_date: form.new_date,
              new_start_time: form.new_start_time,
              new_end_time: form.new_end_time,
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
              <label id="room-change-label" className="block text-sm font-medium mb-1">{t("scheduling.newClassroom", "Nouvelle salle")} *</label>
              {/* The room this session is moving out of, so the change is a
                  comparison rather than a blind pick. */}
              {occ.classroom && (
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] text-text-secondary">
                  <DoorOpen size={11} aria-hidden="true" />
                  {t("scheduling.currentRoom", "Actuellement :")}{" "}
                  <span className="font-medium text-text-primary">{occ.classroom.name}</span>
                </p>
              )}
              <ClassroomPicker
                labelId="room-change-label"
                value={form.new_classroom_id}
                onChange={(id) => setForm((f) => ({ ...f, new_classroom_id: id }))}
                date={actionDate}
                startTime={occ.start_time}
                endTime={occ.end_time}
                excludeEntryId={occ.scheduleEntryId}
                classrooms={classrooms}
              />
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
            {/* Blank keeps the current window; filling both moves the series. */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("scheduling.startTime", "Début")}</label>
                <input
                  type="time"
                  value={form.new_start_time}
                  onChange={(e) => setForm((f) => ({ ...f, new_start_time: e.target.value }))}
                  className="input text-sm w-full"
                  placeholder={t("scheduling.keepCurrent", "Keep current")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("scheduling.endTime", "Fin")}</label>
                <input
                  type="time"
                  value={form.new_end_time}
                  onChange={(e) => setForm((f) => ({ ...f, new_end_time: e.target.value }))}
                  className={`input text-sm w-full ${form.new_end_time && form.new_start_time && form.new_end_time <= form.new_start_time ? "border-danger/50" : ""}`}
                />
              </div>
            </div>
            <p className="text-xs text-text-secondary">
              {t("scheduling.keepCurrentWindowHint", "Laissez vide pour conserver l'horaire actuel.")}
            </p>
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

function MoveForm({ form, setForm, classrooms, professors, entryId, pending, onBack, onSubmit }: {
  form: MoveFormState;
  setForm: (updater: (f: MoveFormState) => MoveFormState) => void;
  classrooms: { id: string; name: string }[];
  professors: { id: string; full_name: string }[];
  /** Excluded from the availability scan so the session never clashes with itself. */
  entryId: string;
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
      {/* The new time, typed. This was a dropdown of declared `time_slots`, so
          a session could only be moved to a window someone had catalogued. */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">{t("scheduling.startTime", "Début")} *</label>
          <input
            type="time"
            value={form.new_start_time}
            onChange={(e) => setForm((f) => ({ ...f, new_start_time: e.target.value }))}
            className="input text-sm w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("scheduling.endTime", "Fin")} *</label>
          <input
            type="time"
            value={form.new_end_time}
            onChange={(e) => setForm((f) => ({ ...f, new_end_time: e.target.value }))}
            className={`input text-sm w-full ${form.new_end_time && form.new_end_time <= form.new_start_time ? "border-danger/50" : ""}`}
          />
        </div>
      </div>
      {form.new_start_time && form.new_end_time && form.new_end_time <= form.new_start_time && (
        <p role="alert" className="text-xs text-danger">
          {t("scheduling.endBeforeStart", "La fin doit être après le début.")}
        </p>
      )}
      <div>
        <label id="move-room-label" className="block text-sm font-medium mb-1">{t("nav.classrooms", "Salle")}</label>
        {/* Availability is checked against the date and time being moved *to*,
            which is the whole point of asking here rather than after the save. */}
        <ClassroomPicker
          labelId="move-room-label"
          value={form.new_classroom_id}
          onChange={(id) => setForm((f) => ({ ...f, new_classroom_id: id }))}
          date={form.new_date}
          startTime={form.new_start_time}
          endTime={form.new_end_time}
          excludeEntryId={entryId}
          classrooms={classrooms}
          allowEmpty
        />
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
        <FormButton
          className="btn btn-primary"
          isLoading={pending}
          disabled={!form.new_date || !form.new_start_time || !form.new_end_time || form.new_end_time <= form.new_start_time}
          onClick={onSubmit}
        >
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