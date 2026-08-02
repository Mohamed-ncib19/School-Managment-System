"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "@/lib/i18n/context";
import type { Group, Professor, Level } from "@/types";

interface AttendanceSheetFormData {
  month: number;
  year: number;
  schedule: string;
  teacherId: string;
}

interface AttendanceSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (data: AttendanceSheetFormData) => void;
  group: Group | null;
  professor: Professor | null;
  level: Level | null;
  professors: Professor[];
  isSuperAdmin: boolean;
}

const MONTH_NAMES_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

const CURRENT_YEAR = new Date().getFullYear();

export function AttendanceSheetModal({
  isOpen,
  onClose,
  onGenerate,
  group,
  professor,
  level,
  professors,
  isSuperAdmin,
}: AttendanceSheetModalProps) {
  const { t } = useTranslation();
  const now = new Date();

  const { register, handleSubmit, reset, watch } = useForm<AttendanceSheetFormData>({
    defaultValues: {
      month: now.getMonth() + 1,
      year: CURRENT_YEAR,
      schedule: "",
      teacherId: "",
    },
  });

  useEffect(() => {
    if (isOpen && group) {
      const schedule = group.schedule_notes ?? "";
      const teacherId = professor?.id ?? "";
      reset({
        month: now.getMonth() + 1,
        year: CURRENT_YEAR,
        schedule,
        teacherId,
      });
    }
  }, [isOpen, group, professor, reset, now.getMonth]);

  const watchSchedule = watch("schedule");

  if (!isOpen || !group) return null;

  const onSubmit = (data: AttendanceSheetFormData) => {
    onGenerate(data);
  };

  const yearOptions = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-surface rounded-modal shadow-hover p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-h4 font-bold mb-4">{t("attendanceSheet.title")}</h3>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t("attendanceSheet.month")} *</label>
              <select {...register("month", { required: true, valueAsNumber: true })} className="input">
                {MONTH_NAMES_FR.map((name, idx) => (
                  <option key={idx} value={idx + 1}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("attendanceSheet.year")} *</label>
              <select {...register("year", { required: true, valueAsNumber: true })} className="input">
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t("attendanceSheet.teacher")}</label>
            <select {...register("teacherId")} className="input">
              <option value="">{t("attendanceSheet.selectTeacher")}</option>
              {professors.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t("attendanceSheet.group")}</label>
            <input type="text" value={group.name} readOnly className="input bg-neutral-100 dark:bg-neutral-800 opacity-70" />
          </div>

          {level && (
            <div>
              <label className="block text-sm font-medium mb-1">{t("attendanceSheet.level")}</label>
              <input type="text" value={level.name} readOnly className="input bg-neutral-100 dark:bg-neutral-800 opacity-70" />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">{t("attendanceSheet.schedule")}</label>
            <textarea
              {...register("schedule")}
              rows={3}
              placeholder={t("attendanceSheet.schedulePlaceholder")}
              className="input"
            />
            <p className="text-xs text-text-secondary mt-1">{t("attendanceSheet.scheduleHint")}</p>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>{t("attendanceSheet.cancel")}</button>
            <button type="submit" className="btn btn-primary">{t("attendanceSheet.generate")}</button>
          </div>
        </form>
      </div>
    </div>
  );
}