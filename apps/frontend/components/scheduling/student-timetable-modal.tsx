"use client";

import { useEffect, useMemo } from "react";
import { X, Printer, AlertTriangle, Plus } from "lucide-react";
import { useStudentSchedule } from "@/hooks/use-scheduling";
import { openStudentTimetable } from "@/lib/api/scheduling.api";
import type { ScheduleEntry, StudentScheduleException } from "@/types";
import { useTranslation } from "@/lib/i18n/context";

const DAY_NAMES = ["Sam", "Dim", "Lun", "Mar", "Mer", "Jeu", "Ven"];

interface StudentTimetableModalProps {
  studentId: string;
  studentName: string;
  open: boolean;
  onClose: () => void;
  onAddException?: (entryId: string) => void;
}

export function StudentTimetableModal({ studentId, studentName, open, onClose, onAddException }: StudentTimetableModalProps) {
  const { t } = useTranslation();
  const today = useMemo(() => new Date().toISOString().split("T")[0], []);
  const toDate = useMemo(() => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], []);
  const { data: entries, isLoading } = useStudentSchedule(studentId, today, toDate);

  const entriesByDay = useMemo(() => {
    const map = new Map<number, ScheduleEntry[]>();
    entries?.forEach((e) => {
      const ts = e.time_slot;
      if (!ts) return;
      const arr = map.get(ts.day_of_week) ?? [];
      arr.push(e);
      map.set(ts.day_of_week, arr);
    });
    return map;
  }, [entries]);

  const overlaps = useMemo(() => {
    const overlaps: { day: number; entries: ScheduleEntry[] }[] = [];
    entriesByDay.forEach((dayEntries, day) => {
      const sorted = [...dayEntries].sort((a, b) => a.time_slot.start_time.localeCompare(b.time_slot.start_time));
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i], b = sorted[i + 1];
        if (a.time_slot.end_time > b.time_slot.start_time) {
          overlaps.push({ day, entries: [a, b] });
        }
      }
    });
    return overlaps;
  }, [entriesByDay]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  /**
   * Prints the server-rendered timetable rather than scraping the modal.
   *
   * Lifting the DOM out of the dialog produced whatever the screen happened to
   * be showing — the modal's own layout, its buttons, its colours stripped —
   * and could only ever print what had already loaded. The server document is
   * built for A4, spans every group the student is enrolled in, and is the
   * same output as the printer action on the student list.
   */
  const handlePrint = () => {
    openStudentTimetable(studentId).catch(() => {
      /* The opened tab reports its own failure. */
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-surface rounded-modal shadow-hover p-6 w-full max-w-5xl mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-h4 font-bold">{t("scheduling.studentTimetable")}</h3>
            <p className="text-sm text-text-secondary">{studentName}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="btn btn-secondary text-xs"><Printer size={14} /> {t("common.print")}</button>
            <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary"><X size={18} /></button>
          </div>
        </div>

        {overlaps.length > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 mb-4">
            <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-red-700 font-medium">{t("scheduling.overlapsFound")}</p>
              {overlaps.map((o, i) => (
                <p key={i} className="text-xs text-red-600 mt-1">
                  {DAY_NAMES[o.day]}: {o.entries[0].group.name} ({o.entries[0].time_slot.start_time}–{o.entries[0].time_slot.end_time}) {t("scheduling.overlapsWith")} {o.entries[1].group.name} ({o.entries[1].time_slot.start_time}–{o.entries[1].time_slot.end_time})
                </p>
              ))}
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-8 text-text-secondary">{t("common.loading", "Loading…")}</div>
        ) : (
          <div className="grid grid-cols-7 gap-2">
            {[0, 1, 2, 3, 4, 5, 6].map((day) => {
              const dayEntries = entriesByDay.get(day) ?? [];
              const hasOverlap = overlaps.some((o) => o.day === day);
              return (
                <div key={day} className={`rounded-lg border p-2 min-h-[120px] ${hasOverlap ? "border-red-300 bg-red-50/30" : "border-border"}`}>
                  <p className="text-xs font-semibold mb-2 text-text-secondary">{DAY_NAMES[day]}</p>
                  {dayEntries.length === 0 ? (
                    <p className="text-xs text-text-secondary/50 italic">{t("scheduling.noSessions")}</p>
                  ) : (
                    <div className="space-y-1">
                      {dayEntries.map((entry) => {
                      const exceptions = (entry as any).studentExceptions as StudentScheduleException[] | undefined;
                      const cancelled = exceptions?.some((ex) => ex.exception_type === "cancelled");
                        const groupColor = entry.group.color ?? "#888";
                        return (
                          <div key={entry.id} className={`text-xs p-1.5 rounded border-l-2 ${cancelled ? "opacity-50 line-through" : ""}`} style={{ borderLeftColor: groupColor }}>
                            <p className="font-medium truncate">{entry.time_slot.start_time}–{entry.time_slot.end_time}</p>
                            <p className="truncate text-text-secondary">{entry.group.name}</p>
                            <p className="truncate text-text-secondary/70">{entry.professor.full_name}</p>
                            {entry.classroom && <p className="truncate text-text-secondary/70">{entry.classroom.name}</p>}
                            {onAddException && !cancelled && (
                              <button onClick={() => onAddException(entry.id)} className="text-primary hover:underline mt-0.5">
                                <Plus size={10} className="inline" /> {t("scheduling.addException")}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div id="student-timetable-print" style={{ display: "none" }}>
          <h1>{t("scheduling.printTitle").replace("{name}", studentName)}</h1>
          <p>{t("scheduling.generatedOn")} {new Date().toLocaleDateString("fr-FR")}</p>
          <table>
            <thead><tr><th>{t("scheduling.timetableDay")}</th><th>{t("scheduling.timetableTime")}</th><th>{t("scheduling.timetableGroup")}</th><th>{t("scheduling.timetableProfessor")}</th><th>{t("scheduling.timetableClassroom")}</th><th>{t("scheduling.timetableSubject")}</th></tr></thead>
            <tbody>
              {entries?.map((entry) => (
                <tr key={entry.id}>
                  <td>{DAY_NAMES[entry.time_slot.day_of_week]}</td>
                  <td>{entry.time_slot.start_time}–{entry.time_slot.end_time}</td>
                  <td>{entry.group.name}</td>
                  <td>{entry.professor.full_name}</td>
                  <td>{entry.classroom?.name ?? "—"}</td>
                  <td>{entry.subject ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
