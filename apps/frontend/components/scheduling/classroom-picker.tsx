"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DoorOpen, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { schedulingApi } from "@/lib/api/scheduling.api";
import { useTranslation } from "@/lib/i18n/context";

/**
 * A room picker that knows which rooms are free.
 *
 * The same three questions come up wherever a session is given a room — is the
 * one I picked free, which ones are, and what is in the way if not — and they
 * were answered differently (or not at all) on each screen: the calendar's
 * room-change dialog was a bare `<select>` that let an operator choose an
 * occupied room and learn about it only from the 409.
 *
 * The availability lookup is the same endpoint the timetable builder uses and
 * applies the same overlap rule the API enforces on save, so what this shows
 * and what the server will accept cannot drift apart.
 */
export interface ClassroomPickerProps {
  value: string;
  onChange: (classroomId: string) => void;
  /** The concrete date the session lands on. */
  date: string;
  startTime: string;
  endTime: string;
  /** The group being edited, so its own sessions do not count against it. */
  excludeGroupId?: string;
  /** The rule being edited, so it does not clash with itself. */
  excludeEntryId?: string;
  classrooms: { id: string; name: string }[];
  /** Adds a "no classroom" option; omit where a room is required. */
  allowEmpty?: boolean;
  labelId?: string;
  /**
   * Reports whether the current choice is blocked, so a parent form can disable
   * its submit without running the same availability query under a slightly
   * different key — which is two requests for one answer.
   */
  onAvailabilityChange?: (state: { selectedBusy: boolean; noneFree: boolean }) => void;
}

export function ClassroomPicker({
  value,
  onChange,
  date,
  startTime,
  endTime,
  excludeGroupId,
  excludeEntryId,
  classrooms,
  allowEmpty,
  labelId,
  onAvailabilityChange,
}: ClassroomPickerProps) {
  const { t } = useTranslation();

  const enabled = Boolean(date && startTime && endTime && endTime > startTime);

  const { data: availability, isLoading } = useQuery({
    queryKey: ["scheduling", "classroom-availability", date, startTime, endTime, excludeGroupId, excludeEntryId],
    queryFn: () =>
      schedulingApi.classrooms.availability({
        date,
        start_time: startTime.slice(0, 5),
        end_time: endTime.slice(0, 5),
        excludeGroupId,
        excludeEntryId,
      }),
    enabled,
    // The window rarely changes while the dialog is open, and every distinct
    // window is a fresh expansion of every rule on the server.
    staleTime: 30_000,
  });

  const byId = useMemo(
    () => new Map((availability ?? []).map((room) => [room.id, room])),
    [availability],
  );
  const selected = value ? byId.get(value) : undefined;
  const freeRooms = useMemo(() => (availability ?? []).filter((room) => room.available), [availability]);
  const noneFree = Boolean(availability && availability.length > 0 && freeRooms.length === 0);
  const selectedBusy = selected?.available === false;

  useEffect(() => {
    onAvailabilityChange?.({ selectedBusy, noneFree });
  }, [selectedBusy, noneFree, onAvailabilityChange]);

  return (
    <div className="space-y-1.5">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-labelledby={labelId}
        aria-invalid={selectedBusy || undefined}
        className={`input text-sm w-full ${selectedBusy ? "border-danger/60" : ""}`}
      >
        {allowEmpty && <option value="">{t("scheduling.noClassroom", "Aucune salle")}</option>}
        {!allowEmpty && <option value="">{t("scheduling.selectClassroom", "Choisir une salle")}</option>}
        {classrooms.map((room) => {
          const status = byId.get(room.id);
          return (
            <option key={room.id} value={room.id}>
              {room.name}
              {status ? (status.available ? "" : ` — ${t("scheduling.busy", "occupée")}`) : ""}
            </option>
          );
        })}
      </select>

      {isLoading && enabled && (
        <p className="flex items-center gap-1.5 text-[11px] text-text-secondary">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          {t("scheduling.checkingRooms", "Vérification des salles…")}
        </p>
      )}

      {/* Nothing is free: say so plainly rather than let the operator try each
          room in turn and be refused by each. */}
      {!isLoading && noneFree && (
        <p role="alert" className="flex items-start gap-1.5 rounded-btn border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-[11px] text-danger">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t("scheduling.noRoomAvailable", "Aucune salle n'est libre sur ce créneau. Choisissez un autre horaire ou libérez une salle.")}
        </p>
      )}

      {/* The chosen room is taken: name what is in it, and offer the free ones. */}
      {!isLoading && selectedBusy && !noneFree && (
        <div role="alert" className="space-y-1.5 rounded-btn border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-[11px] text-danger">
          <p className="flex items-start gap-1.5">
            <DoorOpen size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {t("scheduling.roomBusyWith", "Cette salle est déjà prise sur ce créneau par")}{" "}
              <span className="font-semibold">{selected?.conflicts.map((c) => c.groupName).join(", ")}</span>
              {selected?.conflicts[0] && (
                <span className="tabular-nums opacity-80">
                  {" "}
                  ({selected.conflicts[0].start_time}–{selected.conflicts[0].end_time})
                </span>
              )}
              .
            </span>
          </p>
          {freeRooms.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="opacity-80">{t("scheduling.freeInstead", "Libres à cette heure :")}</span>
              {freeRooms.slice(0, 4).map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => onChange(room.id)}
                  className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success-soft px-2 py-0.5 font-medium text-success-strong transition-colors hover:bg-success/20"
                >
                  {room.color && (
                    <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: room.color }} />
                  )}
                  {room.name}
                </button>
              ))}
              {freeRooms.length > 4 && <span className="opacity-70">+{freeRooms.length - 4}</span>}
            </div>
          )}
        </div>
      )}

      {/* Positive confirmation, so a valid choice reads as decided rather than
          merely un-objected-to. */}
      {!isLoading && selected?.available && (
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-success-strong">
          <CheckCircle2 size={12} aria-hidden="true" />
          {t("scheduling.roomFree", "Salle libre sur ce créneau.")}
        </p>
      )}
    </div>
  );
}
