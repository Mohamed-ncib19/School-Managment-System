"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, AlertTriangle } from "lucide-react";
import { ScheduleTile } from "@/components/scheduling/schedule-tile";
import { useTimeSlots, useClassrooms, usePreviewConflicts } from "@/hooks/use-scheduling";
import type { TileDto, Conflict } from "@/types";
import { useTranslation } from "@/lib/i18n/context";

const DAY_NAMES = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DAY_SHORT = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

interface WeeklyScheduleBuilderProps {
  groupId?: string;
  profId: string | null;
  initialTiles?: TileDto[];
  onChange: (tiles: TileDto[]) => void;
}

export function WeeklyScheduleBuilder({ groupId, profId, initialTiles = [], onChange }: WeeklyScheduleBuilderProps) {
  const { t } = useTranslation();
  const { data: timeSlots } = useTimeSlots();
  const { data: classrooms } = useClassrooms();
  const previewMutation = usePreviewConflicts();

  const [tiles, setTiles] = useState<TileDto[]>(initialTiles);
  const [tileConflicts, setTileConflicts] = useState<Map<string, Conflict[]>>(new Map());
  const [activeDay, setActiveDay] = useState<number>(0);

  useEffect(() => {
    setTiles(initialTiles);
  }, [initialTiles]);

  const emitChange = useCallback((next: TileDto[]) => {
    setTiles(next);
    onChange(next);
  }, [onChange]);

  const addTile = () => {
    const next = [...tiles, { day_of_week: activeDay, start_time: "09:00", end_time: "10:30", classroom_id: null }];
    emitChange(next);
  };

  const updateTile = (idx: number, patch: Partial<TileDto>) => {
    const next = tiles.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    emitChange(next);
  };

  const removeTile = (idx: number) => {
    emitChange(tiles.filter((_, i) => i !== idx));
    setTileConflicts((prev) => { const n = new Map(prev); n.delete(String(idx)); return n; });
  };

  useEffect(() => {
    if (!profId) return;
    const timer = setTimeout(async () => {
      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        if (!tile.start_time || !tile.end_time || tile.end_time <= tile.start_time) continue;
        try {
          const result = await previewMutation.mutateAsync({
            day_of_week: tile.day_of_week,
            start_time: tile.start_time,
            end_time: tile.end_time,
            prof_id: profId,
            classroom_id: tile.classroom_id ?? null,
            time_slot_id: "preview",
            exclude_group_id: groupId,
          });
          setTileConflicts((prev) => {
            const n = new Map(prev);
            if (result.length > 0) n.set(String(i), result); else n.delete(String(i));
            return n;
          });
        } catch {
          // preview is best-effort
        }
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [tiles, profId, groupId, previewMutation]);

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
    if (!timeSlots?.length) return [0, 1, 2, 3, 4, 5];
    const days = new Set(timeSlots.map((ts) => ts.day_of_week));
    return Array.from(days).sort((a, b) => a - b);
  }, [timeSlots]);

  const classroomOptions = useMemo(() => classrooms ?? [], [classrooms]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {availableDays.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setActiveDay(d)}
            className={`px-3 py-1.5 rounded-btn text-xs font-medium transition-colors ${
              activeDay === d
                ? "bg-primary text-white"
                : "bg-background border border-border text-text-secondary hover:text-text-primary"
            }`}
          >
            {DAY_SHORT[d] ?? `Day ${d}`}
          </button>
        ))}
        <button
          type="button"
          onClick={addTile}
          disabled={!profId}
          className="btn btn-secondary text-xs py-1.5 px-3 ml-auto"
          title={!profId ? t("scheduling.selectProfessorFirst", "Select a professor first") : ""}
        >
          <Plus size={14} /> {t("scheduling.addTime", "Add time")}
        </button>
      </div>

      {!profId && (
        <p className="text-xs text-text-secondary">{t("scheduling.selectProfessorFirst", "Select a professor first to add schedule tiles.")}</p>
      )}

      {tiles.length === 0 ? (
        <p className="text-xs text-text-secondary italic">{t("scheduling.noTiles", "No schedule tiles yet. Pick a day and click Add time.")}</p>
      ) : (
        <div className="space-y-2">
          {(tilesByDay.get(activeDay) ?? []).map(({ tile, idx }) => (
            <ScheduleTile
              key={idx}
              tile={{ ...tile, conflict: tileConflicts.get(String(idx)) }}
              index={idx}
              onChange={(patch) => updateTile(idx, patch)}
              onRemove={() => removeTile(idx)}
              disabled={!profId}
              classrooms={classroomOptions}
            />
          ))}
        </div>
      )}

      {totalConflicts > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
          <AlertTriangle size={16} className="text-red-600 shrink-0" />
          <p className="text-xs text-red-700">
            {totalConflicts} conflict{totalConflicts > 1 ? "s" : ""} detected — you can save anyway; conflicts will be logged for review.
          </p>
        </div>
      )}
    </div>
  );
}
