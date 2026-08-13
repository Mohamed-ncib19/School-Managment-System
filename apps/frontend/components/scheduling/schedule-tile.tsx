"use client";

import { useState } from "react";
import { X, ChevronDown } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import type { TileDto, Conflict } from "@/types";

const DAY_NAMES = ["Sam", "Dim", "Lun", "Mar", "Mer", "Jeu", "Ven"];

/** What the clashing thing is, in the reader's terms rather than the schema's. */
const CONFLICT_LABELS: Record<string, string> = {
  classroom: "salle",
  professor: "professeur",
  student: "étudiant",
};

interface ScheduleTileProps {
  tile: TileDto & { id?: string; conflict?: Conflict[] };
  index: number;
  onChange: (tile: TileDto) => void;
  onRemove: () => void;
  disabled?: boolean;
  classrooms: { id: string; name: string }[];
}

export function ScheduleTile({ tile, index, onChange, onRemove, disabled, classrooms }: ScheduleTileProps) {
  const { t } = useTranslation();
  const [showConflicts, setShowConflicts] = useState(false);
  const conflicts = tile.conflict ?? [];
  const hasConflict = conflicts.length > 0;

  /**
   * A room clash stops the save; a professor or student clash only warns.
   *
   * Showing both in the same red made every overlap look fatal, so the one
   * that genuinely blocks the form was indistinguishable from the one the
   * user is allowed to accept.
   */
  const blocking = conflicts.some((c) => c.type === "classroom");
  const tone = blocking
    ? { border: "border-danger/40", bg: "bg-danger-soft/50", text: "text-danger", panel: "bg-danger-soft/70 text-danger" }
    : { border: "border-gold/40", bg: "bg-gold-50/60", text: "text-gold-600", panel: "bg-gold-50 text-gold-700" };

  const startValid = tile.start_time && /^([01]\d|2[0-3]):[0-5]\d$/.test(tile.start_time);
  const endValid = tile.end_time && /^([01]\d|2[0-3]):[0-5]\d$/.test(tile.end_time);
  const afterStart = startValid && endValid && tile.end_time > tile.start_time;

  /**
   * How long the session actually is.
   *
   * Two time inputs side by side make the reader do the subtraction, and an
   * end time typed before the start reads as valid until something rejects it.
   * Showing the duration turns both into something you can see at a glance.
   */
  const durationLabel = (() => {
    if (!afterStart) return null;
    const [sh, sm] = tile.start_time.split(":").map(Number);
    const [eh, em] = tile.end_time.split(":").map(Number);
    const minutes = eh * 60 + em - (sh * 60 + sm);
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours > 0 ? (rest > 0 ? `${hours}h${String(rest).padStart(2, "0")}` : `${hours}h`) : `${rest}min`;
  })();

  return (
    <div className={`flex flex-wrap items-center gap-2 p-2 rounded-lg border ${hasConflict ? `${tone.border} ${tone.bg}` : "border-border bg-background"}`}>
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
        className={`input text-xs py-1 px-2 w-24 ${!afterStart && endValid ? "border-danger/50" : ""}`}
        disabled={disabled}
      />
      {durationLabel ? (
        <span className="text-[10px] font-semibold text-text-secondary tabular-nums bg-background border border-border rounded-full px-2 py-0.5 shrink-0">
          {durationLabel}
        </span>
      ) : endValid && startValid ? (
        <span className="text-[10px] font-semibold text-danger shrink-0">
          {t("scheduling.endBeforeStart", "Fin avant le début")}
        </span>
      ) : null}

      <select
        value={tile.classroom_id ?? ""}
        onChange={(e) => onChange({ ...tile, classroom_id: e.target.value || null })}
        className="input text-xs py-1 px-2 flex-1 min-w-[120px]"
        disabled={disabled}
      >
        <option value="">{t("scheduling.noClassroom", "Aucune salle")}</option>
        {classrooms.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {hasConflict && (
        <button
          type="button"
          onClick={() => setShowConflicts((s) => !s)}
          className={`text-xs ${tone.text} flex items-center gap-1 shrink-0 hover:underline font-medium`}
        >
          {blocking
            ? t("scheduling.roomTaken", "Salle occupée")
            : `${conflicts.length} ${t("scheduling.overlap", "chevauchement")}${conflicts.length > 1 ? "s" : ""}`}
          <ChevronDown size={12} className={`transition-transform ${showConflicts ? "rotate-180" : ""}`} />
        </button>
      )}

      <button
        type="button"
        onClick={onRemove}
        className="h-7 w-7 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-red-50 transition-colors shrink-0"
        disabled={disabled}
        aria-label={t("scheduling.removeTime", "Supprimer ce créneau")}
      >
        <X size={14} />
      </button>
      {showConflicts && hasConflict && (
        <div className={`w-full text-xs rounded-lg px-3 py-2 ${tone.panel}`}>
          <p className="font-medium mb-1">
            {blocking
              ? t("scheduling.roomTakenHint", "Changez la salle ou l'horaire — deux cours ne peuvent pas partager une salle.")
              : t("scheduling.overlapHint", "Vous pourrez enregistrer malgré tout ; le chevauchement sera consigné.")}
          </p>
          <ul className="space-y-0.5">
            {conflicts.map((c, i) => (
              <li key={i}>
                <span className="font-medium">{c.entityName}</span>
                <span className="opacity-70"> · {CONFLICT_LABELS[c.type] ?? c.type}</span>
                {c.timeSlotLabel ? ` — ${c.timeSlotLabel}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
