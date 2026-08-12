"use client";

import { useMemo } from "react";
import { X } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import type { TileDto, Conflict } from "@/types";

const DAY_NAMES = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

interface ScheduleTileProps {
  tile: TileDto & { id?: string; conflict?: Conflict[] };
  index: number;
  onChange: (tile: TileDto) => void;
  onRemove: () => void;
  disabled?: boolean;
  classrooms: { id: string; name: string; building: string | null }[];
}

export function ScheduleTile({ tile, index, onChange, onRemove, disabled, classrooms }: ScheduleTileProps) {
  const { t } = useTranslation();
  const hasConflict = (tile.conflict?.length ?? 0) > 0;

  const startValid = tile.start_time && /^([01]\d|2[0-3]):[0-5]\d$/.test(tile.start_time);
  const endValid = tile.end_time && /^([01]\d|2[0-3]):[0-5]\d$/.test(tile.end_time);
  const afterStart = startValid && endValid && tile.end_time > tile.start_time;

  return (
    <div className={`flex items-center gap-2 p-2 rounded-lg border ${hasConflict ? "border-red-300 bg-red-50/50" : "border-border bg-background"}`}>
      <span className="text-xs font-medium text-text-secondary w-8 shrink-0">{DAY_NAMES[tile.day_of_week] ?? ""}</span>

      <input
        type="time"
        value={tile.start_time}
        onChange={(e) => onChange({ ...tile, start_time: e.target.value })}
        className="input text-xs py-1 px-2 w-24"
        disabled={disabled}
      />
      <span className="text-text-secondary text-xs">→</span>
      <input
        type="time"
        value={tile.end_time}
        onChange={(e) => onChange({ ...tile, end_time: e.target.value })}
        className={`input text-xs py-1 px-2 w-24 ${!afterStart && endValid ? "border-red-300" : ""}`}
        disabled={disabled}
      />

      <select
        value={tile.classroom_id ?? ""}
        onChange={(e) => onChange({ ...tile, classroom_id: e.target.value || null })}
        className="input text-xs py-1 px-2 flex-1 min-w-[120px]"
        disabled={disabled}
      >
        <option value="">No classroom</option>
        {classrooms.map((c) => (
          <option key={c.id} value={c.id}>
            {c.building ? `${c.building} - ` : ""}{c.name}
          </option>
        ))}
      </select>

      {hasConflict && (
        <span className="text-xs text-red-600 truncate max-w-[150px]" title={tile.conflict!.map((c) => c.entityName).join(", ")}>
          ⚠ {tile.conflict!.length} conflict{tile.conflict!.length > 1 ? "s" : ""}
        </span>
      )}

      <button
        type="button"
        onClick={onRemove}
        className="h-7 w-7 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-red-50 transition-colors shrink-0"
        disabled={disabled}
        aria-label="Remove tile"
      >
        <X size={14} />
      </button>
    </div>
  );
}
