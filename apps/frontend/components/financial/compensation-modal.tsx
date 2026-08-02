"use client";

import { useEffect, useState } from "react";
import { AlertCircle, RotateCcw, X } from "lucide-react";
import { useRemoveCompensation, useUpsertCompensation } from "@/hooks/use-financial";
import { financialApi } from "@/lib/api/financial.api";
import { formatCurrency } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";
import type { CompensationModel } from "@/types";

const MODELS: CompensationModel[] = [
  "percentage",
  "fixed_salary",
  "fixed_per_student",
  "fixed_per_group",
  "hybrid",
  "custom",
];

/** Which inputs each model actually uses — the rest are hidden, not just ignored. */
const USES_PERCENTAGE = new Set<CompensationModel>(["percentage", "hybrid", "custom"]);
const USES_FIXED = new Set<CompensationModel>([
  "fixed_salary",
  "fixed_per_student",
  "fixed_per_group",
  "hybrid",
  "custom",
]);

interface CompensationModalProps {
  profId: string;
  professorName: string;
  current: {
    model: CompensationModel;
    percentage: string | null;
    fixed_amount: string | null;
    custom_formula: string | null;
    is_override: boolean;
    notes: string | null;
  };
  studentCount: number;
  groupCount: number;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * One professor's override of the academy split.
 *
 * The live preview is not decoration: a percentage is abstract, and "a 100 DT
 * payment gives the professor 70 and the academy 30" is the sentence an
 * administrator can actually check before saving. It is computed by the same
 * engine that will apply at the till, so it cannot disagree with the real thing.
 */
export function CompensationModal({
  profId,
  professorName,
  current,
  studentCount,
  groupCount,
  isOpen,
  onClose,
}: CompensationModalProps) {
  const { t } = useTranslation();
  const [model, setModel] = useState<CompensationModel>(current.model);
  const [percentage, setPercentage] = useState(current.percentage ?? "60");
  const [fixedAmount, setFixedAmount] = useState(current.fixed_amount ?? "");
  const [formula, setFormula] = useState(current.custom_formula ?? "");
  const [notes, setNotes] = useState(current.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    professor_share: string;
    school_share: string;
    fixed_component: string;
  } | null>(null);

  const upsert = useUpsertCompensation();
  const remove = useRemoveCompensation();

  // Recomputed server-side so the number shown is the number that will apply.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const timer = setTimeout(() => {
      financialApi
        .previewSplit({
          amount: "100",
          model,
          percentage: percentage || undefined,
          fixed_amount: fixedAmount || undefined,
          custom_formula: formula || undefined,
          student_count: studentCount,
          group_count: groupCount,
        })
        .then((result) => !cancelled && setPreview(result))
        .catch(() => !cancelled && setPreview(null));
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, model, percentage, fixedAmount, formula, studentCount, groupCount]);

  if (!isOpen) return null;

  const fail = (err: unknown) => {
    const message =
      (err as any)?.response?.data?.error?.message ??
      (err as any)?.response?.data?.message ??
      (err as Error)?.message ??
      t("common.somethingWentWrong", "Something went wrong");
    setError(Array.isArray(message) ? message.join(", ") : String(message));
  };

  const save = async () => {
    setError(null);
    try {
      await upsert.mutateAsync({
        profId,
        model,
        percentage: USES_PERCENTAGE.has(model) ? percentage || null : null,
        fixed_amount: USES_FIXED.has(model) ? fixedAmount || null : null,
        custom_formula: model === "custom" ? formula || null : null,
        notes: notes || undefined,
      });
      onClose();
    } catch (err) {
      fail(err);
    }
  };

  const resetToDefault = async () => {
    setError(null);
    try {
      await remove.mutateAsync({ profId });
      onClose();
    } catch (err) {
      fail(err);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("financial.editCompensation", "Compensation")}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-surface rounded-modal shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin">
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div>
            <h3 className="text-sm font-bold text-text-primary">
              {t("financial.editCompensation", "Compensation")}
            </h3>
            <p className="text-xs text-text-secondary mt-0.5">{professorName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close", "Close")}
            className="text-text-secondary hover:text-text-primary p-1"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label htmlFor="comp-model" className="text-xs text-text-secondary block mb-1">
              {t("financial.model", "Model")}
            </label>
            <select
              id="comp-model"
              value={model}
              onChange={(e) => setModel(e.target.value as CompensationModel)}
              className="input w-full text-sm"
            >
              {MODELS.map((option) => (
                <option key={option} value={option}>
                  {t(`financial.models.${option}`, option.replace(/_/g, " "))}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-secondary mt-1">
              {t(`financial.modelHints.${model}`, "")}
            </p>
          </div>

          {USES_PERCENTAGE.has(model) && (
            <div>
              <label htmlFor="comp-pct" className="text-xs text-text-secondary block mb-1">
                {t("financial.professorPercentage", "Professor percentage")} (%)
              </label>
              <input
                id="comp-pct"
                type="text"
                inputMode="decimal"
                value={percentage}
                onChange={(e) => setPercentage(e.target.value)}
                className="input w-full"
              />
            </div>
          )}

          {USES_FIXED.has(model) && (
            <div>
              <label htmlFor="comp-fixed" className="text-xs text-text-secondary block mb-1">
                {t("financial.fixedAmount", "Fixed amount")}
              </label>
              <input
                id="comp-fixed"
                type="text"
                inputMode="decimal"
                value={fixedAmount}
                onChange={(e) => setFixedAmount(e.target.value)}
                className="input w-full"
              />
            </div>
          )}

          {model === "custom" && (
            <div>
              <label htmlFor="comp-formula" className="text-xs text-text-secondary block mb-1">
                {t("financial.customFormula", "Formula")}
              </label>
              <input
                id="comp-formula"
                type="text"
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
                placeholder="amount * percentage / 100"
                className="input w-full font-mono text-xs"
              />
              <p className="text-xs text-text-secondary mt-1">
                {t("financial.formulaVars", "Available: amount, percentage, fixed, students, groups")}
              </p>
            </div>
          )}

          <div>
            <label htmlFor="comp-notes" className="text-xs text-text-secondary block mb-1">
              {t("payments.notes", "Notes")}
            </label>
            <textarea
              id="comp-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input w-full resize-none"
            />
          </div>

          {preview && (
            <div className="rounded-btn border border-border bg-background p-3 space-y-1.5">
              <p className="text-xs font-semibold text-text-secondary uppercase">
                {t("financial.preview", "On a 100 DT payment")}
              </p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">{t("financial.professorShare", "Professor")}</span>
                <span className="font-medium tabular-nums">{formatCurrency(preview.professor_share)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">{t("financial.schoolShare", "School")}</span>
                <span className="font-medium tabular-nums">{formatCurrency(preview.school_share)}</span>
              </div>
              {Number(preview.fixed_component) > 0 && (
                <div className="flex items-center justify-between text-sm pt-1.5 border-t border-border">
                  <span className="text-text-secondary">
                    {t("financial.fixedPerPeriod", "Fixed, per period")}
                  </span>
                  <span className="font-medium tabular-nums">{formatCurrency(preview.fixed_component)}</span>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-btn bg-danger-soft text-danger-strong px-3 py-2 text-xs">
              <AlertCircle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 p-5 border-t border-border">
          {current.is_override ? (
            <button
              type="button"
              onClick={resetToDefault}
              disabled={remove.isPending}
              className="btn btn-secondary text-xs"
            >
              <RotateCcw size={13} aria-hidden="true" />
              {t("financial.useAcademyDefault", "Use academy default")}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn btn-secondary text-xs">
              {t("common.cancel", "Cancel")}
            </button>
            <button type="button" onClick={save} disabled={upsert.isPending} className="btn btn-primary text-xs">
              {upsert.isPending ? t("common.saving", "Saving…") : t("common.save", "Save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
