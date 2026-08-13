"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Plus, AlertTriangle, DoorOpen } from "lucide-react";
import { ScheduleTile } from "@/components/scheduling/schedule-tile";
import { useTimeSlots, useClassrooms } from "@/hooks/use-scheduling";
import type { TileDto, Conflict } from "@/types";
import { useTranslation } from "@/lib/i18n/context";
import { schedulingApi } from "@/lib/api/scheduling.api";

const DAY_NAMES = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DAY_SHORT = ["Sam", "Dim", "Lun", "Mar", "Mer", "Jeu", "Ven"];

interface WeeklyScheduleBuilderProps {
  groupId?: string;
  profId: string | null;
  initialTiles?: TileDto[];
  /** True once the caller's tiles data (e.g. async edit-entries query) has settled. */
  initialTilesLoaded?: boolean;
  onChange: (tiles: TileDto[]) => void;
}

export function WeeklyScheduleBuilder({ groupId, profId, initialTiles = [], initialTilesLoaded = true, onChange }: WeeklyScheduleBuilderProps) {
  const { t } = useTranslation();
  const { data: timeSlots } = useTimeSlots();
  const { data: classrooms } = useClassrooms();

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
   * The time windows the academy already teaches in, offered as one-click adds.
   *
   * Every session had to be typed digit by digit even though a school runs the
   * same few windows all week; these come from the declared time slots, so the
   * common case is a single click and the timetable stays consistent.
   */
  const presets = useMemo(() => {
    const seen = new Map<string, { start_time: string; end_time: string }>();
    for (const slot of timeSlots ?? []) {
      const start = String(slot.start_time).slice(0, 5);
      const end = String(slot.end_time).slice(0, 5);
      const key = `${start}-${end}`;
      if (!seen.has(key)) seen.set(key, { start_time: start, end_time: end });
    }
    return Array.from(seen.values()).sort((a, b) => a.start_time.localeCompare(b.start_time)).slice(0, 5);
  }, [timeSlots]);

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
              {DAY_SHORT[d] ?? `Day ${d}`}
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

      {presets.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">
            {t("scheduling.quickAdd", "Créneaux courants")}
          </span>
          {presets.map((preset) => (
            <button
              key={`${preset.start_time}-${preset.end_time}`}
              type="button"
              onClick={() => addTile(preset)}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:border-primary/40 hover:text-primary transition-colors tabular-nums"
            >
              <Plus size={11} aria-hidden="true" />
              {preset.start_time}–{preset.end_time}
            </button>
          ))}
        </div>
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
            />
          ))}
        </div>
      )}

      {totalConflicts > 0 && (
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
