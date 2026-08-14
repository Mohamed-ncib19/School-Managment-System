"use client";

import { useState } from "react";
import { X, ChevronDown, AlertTriangle, CheckCircle2, DoorOpen, Clock } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import type { TileDto, Conflict } from "@/types";
import type { ClassroomAvailability } from "@/lib/api/scheduling.api";
import { describeWindows, durationLabel, isValidRange, type WorkingHoursResult } from "@/lib/utils/scheduling";

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
  classrooms: { id: string; name: string; color?: string | null }[];
  /** Opening-hours verdict for this tile's day and window. */
  workingHours?: WorkingHoursResult;
  /** Per-room availability for this exact window, once it is valid. */
  availability?: ClassroomAvailability[];
  availabilityLoading?: boolean;
}

export function ScheduleTile({
  tile,
  index,
  onChange,
  onRemove,
  disabled,
  classrooms,
  workingHours,
  availability,
  availabilityLoading,
}: ScheduleTileProps) {
  const { t } = useTranslation();
  const [showConflicts, setShowConflicts] = useState(false);
  const conflicts = tile.conflict ?? [];
  const hasConflict = conflicts.length > 0;

  const rangeValid = isValidRange(tile.start_time, tile.end_time);
  const duration = durationLabel(tile.start_time, tile.end_time);

  /** Out of hours is a refusal, not a warning — the API rejects the save. */
  const outOfHours = workingHours?.status === "partial" || workingHours?.status === "outside";

  /**
   * Which room the availability lookup says is taken.
   *
   * Preferred over the conflict-preview result for the room specifically,
   * because it also knows about every *other* room — which is what turns
   * "unavailable" into "unavailable, take this one instead".
   */
  const selectedAvailability = tile.classroom_id
    ? availability?.find((a) => a.id === tile.classroom_id)
    : undefined;
  const roomTaken = selectedAvailability?.available === false;
  const freeRooms = availability?.filter((a) => a.available) ?? [];
  const noRoomAnywhere = rangeValid && !outOfHours && availability != null && availability.length > 0 && freeRooms.length === 0;

  /**
   * A room clash stops the save; a professor or student clash only warns.
   *
   * Showing both in the same red made every overlap look fatal, so the one
   * that genuinely blocks the form was indistinguishable from the one the
   * user is allowed to accept.
   */
  const blocking = outOfHours || roomTaken || conflicts.some((c) => c.type === "classroom");
  const tone = blocking
    ? { border: "border-danger/40", bg: "bg-danger-soft/50", text: "text-danger", panel: "bg-danger-soft/70 text-danger" }
    : { border: "border-gold/40", bg: "bg-gold-50/60", text: "text-gold-600", panel: "bg-gold-50 text-gold-700" };

  /** Green only when everything checked has come back clean. */
  const allClear =
    rangeValid &&
    !blocking &&
    !hasConflict &&
    workingHours?.status === "inside" &&
    (!tile.classroom_id || selectedAvailability?.available === true);

  const frameClass = blocking
    ? `${tone.border} ${tone.bg}`
    : hasConflict
      ? `${tone.border} ${tone.bg}`
      : allClear
        ? "border-success/40 bg-success-soft/40"
        : "border-border bg-background";

  return (
    <div className={`flex flex-wrap items-center gap-2 p-2 rounded-lg border ${frameClass}`}>
      <span className="text-xs font-medium text-text-secondary w-8 shrink-0">{DAY_NAMES[tile.day_of_week] ?? ""}</span>

      <input
        type="time"
        value={tile.start_time}
        onChange={(e) => onChange({ ...tile, start_time: e.target.value })}
        className={`input text-xs py-1 px-2 w-24 ${outOfHours ? "border-danger/50" : ""}`}
        disabled={disabled}
        aria-label={t("scheduling.startTime", "Heure de début")}
        aria-invalid={outOfHours || undefined}
      />
      <span className="text-text-secondary text-xs" aria-hidden="true">→</span>
      <input
        type="time"
        value={tile.end_time}
        onChange={(e) => onChange({ ...tile, end_time: e.target.value })}
        className={`input text-xs py-1 px-2 w-24 ${!rangeValid && tile.end_time ? "border-danger/50" : outOfHours ? "border-danger/50" : ""}`}
        disabled={disabled}
        aria-label={t("scheduling.endTime", "Heure de fin")}
        aria-invalid={(!rangeValid && !!tile.end_time) || outOfHours || undefined}
      />
      {duration ? (
        <span className="text-[10px] font-semibold text-text-secondary tabular-nums bg-background border border-border rounded-full px-2 py-0.5 shrink-0">
          {duration}
        </span>
      ) : tile.end_time && tile.start_time ? (
        <span className="text-[10px] font-semibold text-danger shrink-0">
          {t("scheduling.endBeforeStart", "Fin avant le début")}
        </span>
      ) : null}

      <select
        value={tile.classroom_id ?? ""}
        onChange={(e) => onChange({ ...tile, classroom_id: e.target.value || null })}
        className={`input text-xs py-1 px-2 flex-1 min-w-[140px] ${roomTaken ? "border-danger/50" : ""}`}
        disabled={disabled}
        aria-label={t("nav.classrooms", "Salle")}
        aria-invalid={roomTaken || undefined}
      >
        <option value="">{t("scheduling.noClassroom", "Aucune salle")}</option>
        {classrooms.map((c) => {
          const room = availability?.find((a) => a.id === c.id);
          // The picker itself says which rooms are free, so the operator does
          // not have to try one, be refused, and try the next.
          const suffix = room ? (room.available ? "" : ` — ${t("scheduling.busy", "occupée")}`) : "";
          return (
            <option key={c.id} value={c.id}>
              {c.name}
              {suffix}
            </option>
          );
        })}
      </select>

      {allClear && (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-success-strong shrink-0">
          <CheckCircle2 size={12} aria-hidden="true" />
          {t("scheduling.slotOk", "Créneau libre")}
        </span>
      )}

      {hasConflict && !outOfHours && (
        <button
          type="button"
          onClick={() => setShowConflicts((s) => !s)}
          className={`text-xs ${tone.text} flex items-center gap-1 shrink-0 hover:underline font-medium`}
        >
          {conflicts.some((c) => c.type === "classroom")
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

      {/*
        Messages sit under the row that caused them and say what to change,
        in the order the operator can act on them: the hours decide whether the
        window is legal at all, and only then does the room matter.
      */}
      {outOfHours && (
        <p role="alert" className="w-full flex items-start gap-1.5 text-xs rounded-lg px-3 py-2 bg-danger-soft/70 text-danger">
          <Clock size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {workingHours?.status === "partial"
              ? t(
                  "scheduling.partiallyOutsideHours",
                  "Ce créneau dépasse les horaires d'ouverture. Ramenez-le à l'intérieur de :",
                )
              : t(
                  "scheduling.outsideHours",
                  "Ce créneau est en dehors des horaires d'ouverture. Horaires de ce jour :",
                )}{" "}
            <span className="font-semibold tabular-nums">{describeWindows(workingHours?.windows ?? [])}</span>
          </span>
        </p>
      )}

      {!outOfHours && noRoomAnywhere && (
        <p role="alert" className="w-full flex items-start gap-1.5 text-xs rounded-lg px-3 py-2 bg-danger-soft/70 text-danger">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t(
              "scheduling.noRoomAvailable",
              "Aucune salle n'est libre sur ce créneau. Choisissez un autre horaire ou libérez une salle.",
            )}
          </span>
        </p>
      )}

      {!outOfHours && roomTaken && !noRoomAnywhere && (
        <div className="w-full text-xs rounded-lg px-3 py-2 bg-danger-soft/70 text-danger space-y-1.5">
          <p className="flex items-start gap-1.5">
            <DoorOpen size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {t("scheduling.roomBusyWith", "Cette salle est déjà prise sur ce créneau par")}{" "}
              <span className="font-semibold">
                {selectedAvailability?.conflicts.map((c) => c.groupName).join(", ")}
              </span>
              {selectedAvailability?.conflicts[0] && (
                <span className="tabular-nums opacity-80">
                  {" "}
                  ({selectedAvailability.conflicts[0].start_time}–{selectedAvailability.conflicts[0].end_time})
                </span>
              )}
              .
            </span>
          </p>
          {freeRooms.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="opacity-80">{t("scheduling.freeInstead", "Libres à cette heure :")}</span>
              {/* One click swaps the room — the alternative is offered, not just described. */}
              {freeRooms.slice(0, 4).map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => onChange({ ...tile, classroom_id: room.id })}
                  className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success-strong hover:bg-success/20 transition-colors"
                >
                  {room.color && (
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: room.color }}
                    />
                  )}
                  {room.name}
                </button>
              ))}
              {freeRooms.length > 4 && (
                <span className="opacity-70">+{freeRooms.length - 4}</span>
              )}
            </div>
          )}
        </div>
      )}

      {availabilityLoading && rangeValid && !outOfHours && (
        <p className="w-full text-[11px] text-text-secondary">
          {t("scheduling.checkingRooms", "Vérification des salles…")}
        </p>
      )}

      {showConflicts && hasConflict && (
        <div className={`w-full text-xs rounded-lg px-3 py-2 ${tone.panel}`}>
          <p className="font-medium mb-1">
            {conflicts.some((c) => c.type === "classroom")
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
