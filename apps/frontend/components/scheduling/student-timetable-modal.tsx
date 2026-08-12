"use client";

import { useEffect, useMemo } from "react";
import { X, Printer, AlertTriangle, Plus } from "lucide-react";
import { useStudentSchedule, useMultiGroupCheck } from "@/hooks/use-scheduling";
import type { ScheduleEntry, StudentScheduleException } from "@/types";
import { useTranslation } from "@/lib/i18n/context";

const DAY_NAMES = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

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
  const { data: eligibility } = useMultiGroupCheck(studentId);

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

  const handlePrint = () => {
    const printContent = document.getElementById("student-timetable-print");
    if (!printContent) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>Timetable - ${studentName}</title><style>
      body { font-family: sans-serif; padding: 40px; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
      th { background: #f5f5f5; }
    </style></head><body>${printContent.innerHTML}</body></html>`);
    w.document.close();
    w.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-surface rounded-modal shadow-hover p-6 w-full max-w-5xl mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-h4 font-bold">{t("scheduling.studentTimetable", "Student Timetable")}</h3>
            <p className="text-sm text-text-secondary">{studentName}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="btn btn-secondary text-xs"><Printer size={14} /> {t("common.print", "Print")}</button>
            <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-primary"><X size={18} /></button>
          </div>
        </div>

        {overlaps.length > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 mb-4">
            <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-red-700 font-medium">{t("scheduling.overlapsFound", "Overlapping sessions detected")}</p>
              {overlaps.map((o, i) => (
                <p key={i} className="text-xs text-red-600 mt-1">
                  {DAY_NAMES[o.day]}: {o.entries[0].group.name} ({o.entries[0].time_slot.start_time}–{o.entries[0].time_slot.end_time}) overlaps with {o.entries[1].group.name} ({o.entries[1].time_slot.start_time}–{o.entries[1].time_slot.end_time})
                </p>
              ))}
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-8 text-text-secondary">{t("common.loading", "Loading…")}</div>
        ) : (
          <div className="grid grid-cols-6 gap-2">
            {[0, 1, 2, 3, 4, 5].map((day) => {
              const dayEntries = entriesByDay.get(day) ?? [];
              const hasOverlap = overlaps.some((o) => o.day === day);
              return (
                <div key={day} className={`rounded-lg border p-2 min-h-[120px] ${hasOverlap ? "border-red-300 bg-red-50/30" : "border-border"}`}>
                  <p className="text-xs font-semibold mb-2 text-text-secondary">{DAY_NAMES[day]}</p>
                  {dayEntries.length === 0 ? (
                    <p className="text-xs text-text-secondary/50 italic">{t("scheduling.noSessions", "No sessions")}</p>
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
                                <Plus size={10} className="inline" /> {t("scheduling.addException", "Add exception")}
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
          <h1>Timetable - {studentName}</h1>
          <p>Generated on {new Date().toLocaleDateString()}</p>
          <table>
            <thead><tr><th>Day</th><th>Time</th><th>Group</th><th>Professor</th><th>Classroom</th><th>Subject</th></tr></thead>
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
