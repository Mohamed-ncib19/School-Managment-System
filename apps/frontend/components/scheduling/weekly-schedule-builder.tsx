"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Plus, AlertTriangle, DoorOpen, Clock } from "lucide-react";
import { ScheduleTile } from "@/components/scheduling/schedule-tile";
import { useClassrooms, useWorkingHours } from "@/hooks/use-scheduling";
import type { TileDto, Conflict } from "@/types";
import { useTranslation } from "@/lib/i18n/context";
import { schedulingApi, type ClassroomAvailability } from "@/lib/api/scheduling.api";
import {
  checkWorkingHours,
  describeWindows,
  isValidRange,
  nextDateForSchoolDay,
  windowsForDay,
  type WorkingHoursResult,
} from "@/lib/utils/scheduling";

const DAY_SHORT = ["Sam", "Dim", "Lun", "Mar", "Mer", "Jeu", "Ven"];

interface WeeklyScheduleBuilderProps {
  groupId?: string;
  profId: string | null;
  initialTiles?: TileDto[];
  /** True once the caller's tiles data (e.g. async edit-entries query) has settled. */
  initialTilesLoaded?: boolean;
  onChange: (tiles: TileDto[]) => void;
  /**
   * Raised whenever a tile breaks a rule the API will refuse (out of opening
   * hours, or a room that is taken). The caller disables its save button on it,
   * so the form cannot submit something that is going to come back 409.
   */
  onValidityChange?: (blocked: boolean) => void;
}

export function WeeklyScheduleBuilder({ groupId, profId, initialTiles = [], initialTilesLoaded = true, onChange, onValidityChange }: WeeklyScheduleBuilderProps) {
  const { t } = useTranslation();
  const { data: classrooms } = useClassrooms();
  const { data: workingHours } = useWorkingHours();

  const [tiles, setTiles] = useState<TileDto[]>(initialTiles);
  const [tileConflicts, setTileConflicts] = useState<Map<string, Conflict[]>>(new Map());
  const [activeDay, setActiveDay] = useState<number>(0);
  const previewAbortRef = useRef<AbortController | null>(null);
  const dirtyIndexRef = useRef<number | null>(null);
  const lastPreviewedRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    // Don't clobber draft tiles while the caller is still loading persisted
    // tiles (edit mode); the flip of `initialTilesLoaded` triggers the reset.
    if (groupId && !initialTilesLoaded) return;
    setTiles(initialTiles);
    setTileConflicts(new Map());
    lastPreviewedRef.current = new Map();
  }, [groupId, initialTilesLoaded]);

  const emitChange = useCallback((next: TileDto[], dirtyIndex?: number) => {
    setTiles(next);
    onChange(next);
    if (typeof dirtyIndex === "number") {
      dirtyIndexRef.current = dirtyIndex;
    }
  }, [onChange]);

  const addTile = (preset?: { start_time: string; end_time: string }) => {
    const next = [
      ...tiles,
      {
        day_of_week: activeDay,
        start_time: preset?.start_time ?? "09:00",
        end_time: preset?.end_time ?? "10:30",
        classroom_id: null,
      },
    ];
    emitChange(next, next.length - 1);
  };

  const updateTile = (idx: number, patch: Partial<TileDto>) => {
    const next = tiles.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    emitChange(next, idx);
  };

  const removeTile = (idx: number) => {
    const next = tiles.filter((_, i) => i !== idx);
    emitChange(next);
    setTileConflicts((prev) => {
      const n = new Map(prev);
      n.delete(String(idx));
      return n;
    });
    lastPreviewedRef.current.delete(String(idx));
  };

  useEffect(() => {
    if (!profId) return;
    if (previewAbortRef.current) {
      previewAbortRef.current.abort();
    }
    const controller = new AbortController();
    previewAbortRef.current = controller;

    const dirtyIndex = dirtyIndexRef.current;
    const indicesToCheck = typeof dirtyIndex === "number" && tiles[dirtyIndex] ? [dirtyIndex] : tiles.map((_, i) => i);

    const timer = setTimeout(async () => {
      const nextConflicts = new Map<string, Conflict[]>();
      for (const i of indicesToCheck) {
        const tile = tiles[i];
        if (!tile) continue;
        const key = `${i}:${tile.start_time}:${tile.end_time}:${tile.classroom_id ?? ""}`;
        if (!tile.start_time || !tile.end_time || tile.end_time <= tile.start_time) {
          nextConflicts.delete(String(i));
          continue;
        }
        if (lastPreviewedRef.current.get(String(i)) === key) continue;
        try {
          const result = await schedulingApi.conflicts.preview({
            day_of_week: tile.day_of_week,
            start_time: tile.start_time,
            end_time: tile.end_time,
            prof_id: profId,
            classroom_id: tile.classroom_id ?? null,
            exclude_group_id: groupId,
          });
          if (controller.signal.aborted) return;
          if (result.length > 0) nextConflicts.set(String(i), result);
          else nextConflicts.delete(String(i));
          lastPreviewedRef.current.set(String(i), key);
        } catch {
          if (controller.signal.aborted) return;
        }
      }
      if (!controller.signal.aborted) {
        setTileConflicts(nextConflicts);
      }
      dirtyIndexRef.current = null;
    }, 700);

    return () => {
      controller.abort();
      clearTimeout(timer);
      dirtyIndexRef.current = null;
    };
  }, [tiles, profId, groupId]);

  const tilesByDay = useMemo(() => {
    const map = new Map<number, { tile: TileDto; idx: number }[]>();
    tiles.forEach((tile, idx) => {
      const arr = map.get(tile.day_of_week) ?? [];
      arr.push({ tile, idx });
      map.set(tile.day_of_week, arr);
    });
    return map;
  }, [tiles]);

  const totalConflicts = useMemo(() => {
    let count = 0;
    tileConflicts.forEach((c) => { count += c.length; });
    return count;
  }, [tileConflicts]);

  const availableDays = useMemo(() => {
    return [0, 1, 2, 3, 4, 5, 6];
  }, []);

  const classroomOptions = useMemo(() => classrooms ?? [], [classrooms]);

  /**
   * The opening-hours verdict per tile.
   *
   * Computed in the browser from the same rules the API applies, so the field
   * can explain itself as it is typed rather than on submit. The server still
   * refuses an out-of-hours save — this only makes the refusal predictable.
   */
  const hoursByTile = useMemo(() => {
    const map = new Map<number, WorkingHoursResult>();
    tiles.forEach((tile, idx) => {
      if (!isValidRange(tile.start_time, tile.end_time)) return;
      map.set(idx, checkWorkingHours(workingHours, tile.day_of_week, tile.start_time, tile.end_time));
    });
    return map;
  }, [tiles, workingHours]);

  /**
   * Room availability, fetched once per distinct window rather than per tile.
   *
   * Two tiles at the same day and time ask the same question, and the answer is
   * keyed by the window alone. Only windows that are valid and inside opening
   * hours are asked about: there is no point costing a request on a range the
   * form is already refusing.
   */
  const [availability, setAvailability] = useState<Map<string, ClassroomAvailability[]>>(new Map());
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const availabilityAbortRef = useRef<AbortController | null>(null);

  const windowKey = (tile: TileDto) => `${tile.day_of_week}|${tile.start_time}|${tile.end_time}`;

  const neededWindows = useMemo(() => {
    const out = new Map<string, TileDto>();
    tiles.forEach((tile, idx) => {
      if (!isValidRange(tile.start_time, tile.end_time)) return;
      const hours = hoursByTile.get(idx);
      if (hours && (hours.status === "partial" || hours.status === "outside")) return;
      out.set(windowKey(tile), tile);
    });
    return out;
  }, [tiles, hoursByTile]);

  useEffect(() => {
    const missing = Array.from(neededWindows.keys()).filter((k) => !availability.has(k));
    if (missing.length === 0) {
      setAvailabilityLoading(false);
      return;
    }

    availabilityAbortRef.current?.abort();
    const controller = new AbortController();
    availabilityAbortRef.current = controller;
    setAvailabilityLoading(true);

    const timer = setTimeout(async () => {
      try {
        const results = await Promise.all(
          missing.map(async (key) => {
            const tile = neededWindows.get(key)!;
            const rows = await schedulingApi.classrooms.availability({
              date: nextDateForSchoolDay(tile.day_of_week),
              start_time: tile.start_time,
              end_time: tile.end_time,
              // The group being edited must not conflict with itself.
              excludeGroupId: groupId,
            });
            return [key, rows] as const;
          }),
        );
        if (controller.signal.aborted) return;
        setAvailability((prev) => {
          const next = new Map(prev);
          for (const [key, rows] of results) next.set(key, rows);
          return next;
        });
      } catch {
        // A failed lookup must not block the form: the server still validates.
      } finally {
        if (!controller.signal.aborted) setAvailabilityLoading(false);
      }
    }, 400);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [neededWindows, availability, groupId]);

  /**
   * Whether the form may be submitted.
   *
   * Only the two rules the API refuses outright count as blocking: a window
   * outside opening hours, and a room already taken. Professor and student
   * overlaps stay overridable, as they were.
   */
  const blockedTiles = useMemo(() => {
    const reasons: string[] = [];
    tiles.forEach((tile, idx) => {
      if (!isValidRange(tile.start_time, tile.end_time)) {
        if (tile.start_time && tile.end_time) {
          reasons.push(`${DAY_SHORT[tile.day_of_week]} — ${t("scheduling.endBeforeStart", "Fin avant le début")}`);
        }
        return;
      }
      const hours = hoursByTile.get(idx);
      if (hours && (hours.status === "partial" || hours.status === "outside")) {
        reasons.push(
          `${DAY_SHORT[tile.day_of_week]} ${tile.start_time}–${tile.end_time} — ${t("scheduling.outsideHoursShort", "hors horaires")} (${describeWindows(hours.windows)})`,
        );
        return;
      }
      const rooms = availability.get(windowKey(tile));
      if (!rooms) return;
      if (tile.classroom_id && rooms.find((r) => r.id === tile.classroom_id)?.available === false) {
        reasons.push(
          `${DAY_SHORT[tile.day_of_week]} ${tile.start_time}–${tile.end_time} — ${t("scheduling.roomTaken", "salle occupée")}`,
        );
      }
    });
    return reasons;
  }, [tiles, hoursByTile, availability, t]);

  useEffect(() => {
    onValidityChange?.(blockedTiles.length > 0);
  }, [blockedTiles, onValidityChange]);

  /** The declared opening hours for the day being edited, shown as guidance. */
  const activeDayWindows = useMemo(
    () => windowsForDay(workingHours, activeDay),
    [workingHours, activeDay],
  );

  /** Every session in the week, ordered, for the summary strip. */
  const weekSummary = useMemo(
    () =>
      [...tiles]
        .map((tile, idx) => ({ tile, idx }))
        .sort(
          (a, b) =>
            a.tile.day_of_week - b.tile.day_of_week ||
            a.tile.start_time.localeCompare(b.tile.start_time),
        ),
    [tiles],
  );

  /** Sessions on the day currently being edited. */
  const activeTiles = tilesByDay.get(activeDay) ?? [];

  /** A room clash blocks the save; everything else only warns. */
  const blockingConflicts = useMemo(() => {
    let count = 0;
    tileConflicts.forEach((list) => {
      if (list.some((c) => c.type === "classroom")) count += 1;
    });
    return count;
  }, [tileConflicts]);

  return (
    <div className="space-y-3">
      {/*
        The whole week at a glance. The day chips used to give no indication of
        which days already had sessions, so the only way to find out was to
        click through all seven — on a form whose entire purpose is the shape of
        the week.
      */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {availableDays.map((d) => {
          const count = tilesByDay.get(d)?.length ?? 0;
          const active = activeDay === d;
          return (
            <button
              key={d}
              type="button"
              onClick={() => setActiveDay(d)}
              aria-pressed={active}
              className={`relative px-3 py-1.5 rounded-btn text-xs font-medium transition-colors ${
                active
                  ? "bg-primary text-white"
                  : count > 0
                    ? "bg-primary-50 border border-primary/30 text-primary hover:bg-primary-100"
                    : "bg-background border border-border text-text-secondary hover:text-text-primary"
              }`}
            >
              {DAY_SHORT[d] ?? `Jour ${d}`}
              {count > 0 && (
                <span
                  className={`ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 rounded-full px-1 text-[10px] font-semibold tabular-nums ${
                    active ? "bg-white/25 text-white" : "bg-primary text-white"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => addTile()}
          className="btn btn-secondary text-xs py-1.5 px-3 ml-auto"
        >
          <Plus size={14} /> {t("scheduling.addTime", "Ajouter un créneau")}
        </button>
      </div>

      {/*
        The day's opening hours, stated where the times are typed.
        The predefined "créneaux courants" chips that used to sit here came from
        the `time_slots` table and existed to spare the operator typing — but
        they also made the declared slots feel like the only permitted windows.
        Times are now typed directly, so the useful thing to show is the range
        they have to land inside.
      */}
      {activeDayWindows.length > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-text-secondary">
          <Clock size={12} className="shrink-0" aria-hidden="true" />
          {t("scheduling.dayHours", "Horaires d'ouverture ce jour :")}{" "}
          <span className="font-semibold tabular-nums text-text-primary">{describeWindows(activeDayWindows)}</span>
        </p>
      )}

      {/*
        The week as one line. Editing happens a day at a time, so without this
        there is no view in which the whole timetable being built is visible.
      */}
      {weekSummary.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap rounded-btn border border-border bg-background px-2.5 py-2">
          <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mr-0.5">
            {t("scheduling.weekOverview", "Semaine")}
          </span>
          {weekSummary.map(({ tile, idx }) => (
            <button
              key={idx}
              type="button"
              onClick={() => setActiveDay(tile.day_of_week)}
              title={t("scheduling.goToDay", "Aller à ce jour")}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors ${
                tileConflicts.get(String(idx))?.length
                  ? "bg-gold-50 text-gold-700 border border-gold/40"
                  : "bg-primary-50 text-primary border border-primary/25 hover:bg-primary-100"
              }`}
            >
              <span className="font-semibold">{DAY_SHORT[tile.day_of_week]}</span>
              {tile.start_time}–{tile.end_time}
            </button>
          ))}
        </div>
      )}

      {classroomOptions.length === 0 && (
        <p className="flex items-center gap-2 text-xs text-text-secondary rounded-btn border border-border bg-background px-3 py-2">
          <DoorOpen size={14} className="shrink-0" aria-hidden="true" />
          {t(
            "scheduling.noClassroomsHint",
            "Aucune salle déclarée — ajoutez-en dans Emploi du temps › Salles pour pouvoir en assigner une.",
          )}
        </p>
      )}

      {!profId && (
        <p className="text-xs text-text-secondary">
          {t("scheduling.selectProfessorFirst", "Choisissez un professeur pour activer la vérification des disponibilités.")}
        </p>
      )}

      {tiles.length === 0 ? (
        <p className="text-xs text-text-secondary italic">
          {t("scheduling.noTiles", "Aucune séance. Choisissez un jour puis « Ajouter un créneau ».")}
        </p>
      ) : activeTiles.length === 0 ? (
        <p className="text-xs text-text-secondary italic">
          {t("scheduling.noTilesThisDay", "Aucune séance ce jour-là.")}
        </p>
      ) : (
        <div className="space-y-2">
          {activeTiles.map(({ tile, idx }) => (
            <ScheduleTile
              key={idx}
              tile={{ ...tile, conflict: tileConflicts.get(String(idx)) }}
              index={idx}
              onChange={(patch) => updateTile(idx, patch)}
              onRemove={() => removeTile(idx)}
              classrooms={classroomOptions}
              workingHours={hoursByTile.get(idx)}
              availability={availability.get(windowKey(tile))}
              availabilityLoading={availabilityLoading && !availability.has(windowKey(tile))}
            />
          ))}
        </div>
      )}

      {/*
        Blocking reasons first and itemised: the operator is editing one day at
        a time, so a problem on another day is otherwise invisible until save.
      */}
      {blockedTiles.length > 0 && (
        <div role="alert" className="flex items-start gap-2 p-3 rounded-lg border bg-danger-soft border-danger/30">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-danger" aria-hidden="true" />
          <div className="text-xs text-danger space-y-1">
            <p className="font-medium">
              {t("scheduling.blockedSummary", "Ces créneaux empêchent l'enregistrement :")}
            </p>
            <ul className="space-y-0.5">
              {blockedTiles.map((reason, i) => (
                <li key={i} className="tabular-nums">{reason}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {totalConflicts > 0 && blockedTiles.length === 0 && (
        <div
          className={`flex items-start gap-2 p-3 rounded-lg border ${
            blockingConflicts > 0 ? "bg-danger-soft border-danger/30" : "bg-gold-50 border-gold/30"
          }`}
        >
          <AlertTriangle
            size={16}
            className={`shrink-0 mt-0.5 ${blockingConflicts > 0 ? "text-danger" : "text-gold-500"}`}
            aria-hidden="true"
          />
          <p className={`text-xs ${blockingConflicts > 0 ? "text-danger" : "text-gold-700"}`}>
            {blockingConflicts > 0
              ? t(
                  "scheduling.blockingSummary",
                  "Une salle est déjà occupée sur un de ces créneaux. Changez la salle ou l'horaire pour enregistrer.",
                )
              : t(
                  "scheduling.warningSummary",
                  "Ces créneaux en chevauchent d'autres. Vous pourrez confirmer à l'enregistrement.",
                )}
          </p>
        </div>
      )}
    </div>
  );
}
