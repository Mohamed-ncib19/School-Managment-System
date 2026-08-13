"use client";

import { useState } from "react";
import { Plus, Trash2, Clock, Save } from "lucide-react";
import { useWorkingHours, useWorkingHoursBounds, useUpsertWorkingHours, useWorkingHoursEmpty } from "@/hooks/use-scheduling";
import type { WorkingHourWindow } from "@/lib/api/scheduling.api";
import { PageLoader } from "@/components/shared/skeletons";
import { FormButton } from "@/components/forms/form-helpers";
import { useTranslation } from "@/lib/i18n/context";

const DAY_NAMES = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

interface DayWindows {
  [day: number]: Array<{ start_time: string; end_time: string }>;
}

function toDayMap(rows: WorkingHourWindow[] | undefined): DayWindows {
  const out: DayWindows = {};
  for (let day = 0; day < 7; day++) out[day] = [];
  if (!rows) return out;
  for (const row of rows) {
    // Every-day default rows apply to every day in the editor view; saving
    // flattens them into per-day windows so the grid stays predictable.
    const target = row.day_of_week === null ? [0, 1, 2, 3, 4, 5, 6] : [row.day_of_week];
    for (const day of target) {
      if (day >= 0 && day <= 6) out[day].push({ start_time: row.start_time, end_time: row.end_time });
    }
  }
  return out;
}

export default function WorkingHoursPage() {
  const { t } = useTranslation();
  const { data: rows, isLoading } = useWorkingHours();
  const { data: bounds } = useWorkingHoursBounds();
  const { data: isEmpty } = useWorkingHoursEmpty();
  const upsert = useUpsertWorkingHours();
  const [draft, setDraft] = useState<DayWindows | null>(null);
  const [error, setError] = useState("");

  const windows = draft ?? toDayMap(rows);
  const minTime = bounds?.min ?? "08:00";
  const maxTime = bounds?.max ?? "18:00";

  const setWindowTime = (day: number, index: number, field: "start_time" | "end_time", value: string) => {
    setDraft((d) => {
      const next: DayWindows = d ? JSON.parse(JSON.stringify(d)) : toDayMap(rows);
      next[day][index][field] = value;
      return next;
    });
    setError("");
  };

  const addWindow = (day: number) => {
    setDraft((d) => {
      const next: DayWindows = d ? JSON.parse(JSON.stringify(d)) : toDayMap(rows);
      next[day].push({ start_time: minTime, end_time: maxTime });
      return next;
    });
    setError("");
  };

  const removeWindow = (day: number, index: number) => {
    setDraft((d) => {
      const next: DayWindows = d ? JSON.parse(JSON.stringify(d)) : toDayMap(rows);
      next[day].splice(index, 1);
      return next;
    });
    setError("");
  };

  const handleSave = () => {
    const flat: WorkingHourWindow[] = [];
    for (const [dayStr, list] of Object.entries(windows)) {
      const day = Number(dayStr);
      for (const w of list) {
        if (!w.start_time || !w.end_time) continue;
        if (w.start_time >= w.end_time) {
          setError(t("workingHours.invalidWindow", `Day ${DAY_NAMES[day]}: end time must be after start time`));
          return;
        }
        flat.push({ day_of_week: day, start_time: w.start_time, end_time: w.end_time });
      }
    }
    upsert.mutate(flat, {
      onSuccess: () => setDraft(null),
      onError: (err: any) => setError(err?.response?.data?.message?.join?.(", ") ?? err?.response?.data?.message ?? t("common.error", "Something went wrong")),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-h4 font-bold text-text-primary">{t("nav.workingHours", "Working hours")}</h2>
          <p className="text-xs text-text-secondary mt-1">
            {t("workingHours.subtitle", "The school's operating windows — the calendar shades them and new sessions outside them warn you.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {draft && (
            <button className="btn btn-secondary text-xs" onClick={() => setDraft(null)}>
              {t("common.cancel", "Cancel")}
            </button>
          )}
          <FormButton isLoading={upsert.isPending} onClick={handleSave} className="btn btn-primary text-xs">
            <Save size={14} /> {t("common.save", "Save")}
          </FormButton>
        </div>
      </div>

      {error && <div className="rounded-btn border border-danger/40 bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</div>}

      {isEmpty && !draft && rows?.length === 0 && (
        <div className="rounded-btn border border-gold/40 bg-gold-50 dark:bg-gold/10 px-4 py-3 text-sm">
          {t("workingHours.emptyHint", "No working hours configured yet — add at least one window per day to get started, or leave all days empty to disable the feature.")}
        </div>
      )}

      {isLoading ? (
        <PageLoader text={t("common.loading", "Loading...")} />
      ) : (
        <div className="card divide-y divide-border">
          {DAY_NAMES.map((dayName, day) => (
            <div key={day} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3">
              <div className="w-32 shrink-0 flex items-center gap-2">
                <Clock size={15} className="text-text-secondary" />
                <span className="text-sm font-medium">{dayName}</span>
              </div>
              <div className="flex-1 space-y-2">
                {windows[day].length === 0 && (
                  <p className="text-xs text-text-secondary">{t("workingHours.noWindow", "No sessions on this day")}</p>
                )}
                {windows[day].map((w, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="time"
                      value={w.start_time}
                      onChange={(e) => setWindowTime(day, i, "start_time", e.target.value)}
                      className="input text-xs w-[120px]"
                    />
                    <span className="text-text-secondary text-xs">–</span>
                    <input
                      type="time"
                      value={w.end_time}
                      onChange={(e) => setWindowTime(day, i, "end_time", e.target.value)}
                      className="input text-xs w-[120px]"
                    />
                    <button
                      type="button"
                      onClick={() => removeWindow(day, i)}
                      className="h-7 w-7 inline-flex items-center justify-center rounded-btn text-text-secondary hover:text-danger hover:bg-red-50 transition-colors"
                      aria-label={t("common.delete", "Delete")}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => addWindow(day)} className="btn btn-secondary text-xs shrink-0">
                <Plus size={13} /> {t("workingHours.addWindow", "Add window")}
              </button>
            </div>
          ))}
          <div className="flex justify-end gap-2 px-4 py-3">
            <button className="btn btn-secondary text-xs" onClick={() => upsert.mutate([])}>
              {t("workingHours.clearAll", "Clear all")}
            </button>
            <FormButton isLoading={upsert.isPending} onClick={handleSave} className="btn btn-primary text-xs">
              <Save size={14} /> {t("common.save", "Save")}
            </FormButton>
          </div>
        </div>
      )}
    </div>
  );
}