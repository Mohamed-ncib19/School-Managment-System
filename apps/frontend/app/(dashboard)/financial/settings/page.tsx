"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  Banknote,
  Building2,
  CalendarDays,
  Calculator,
  Check,
  Clock,
  ReceiptText,
  Save,
  type LucideIcon,
} from "lucide-react";
import { useFinancialSettings, useUpdateFinancialSettings } from "@/hooks/use-financial";
import { ErrorState } from "@/components/financial/error-state";
import { financialApi } from "@/lib/api/financial.api";
import { formatCurrency } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils/format";
import type { CompensationModel, FinancialSettings } from "@/types";

const MODELS: CompensationModel[] = [
  "percentage",
  "fixed_salary",
  "fixed_per_student",
  "fixed_per_group",
  "hybrid",
  "custom",
];

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

/**
 * Financial settings — the academy-wide defaults.
 *
 * Everything here is a *default*: a professor with their own arrangement is
 * unaffected, which the screen says out loud, because "we changed the split to
 * 70%" and "everyone is now on 70%" are different claims and confusing them is
 * expensive.
 */
export default function FinancialSettingsPage() {
  const { t } = useTranslation();
  const { data: settings, isLoading, isError, refetch } = useFinancialSettings();
  const update = useUpdateFinancialSettings();

  const [form, setForm] = useState<Partial<FinancialSettings>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<{ professor_share: string; school_share: string } | null>(null);
  const [receiptSample, setReceiptSample] = useState("");

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const model = (form.default_compensation_model ?? "percentage") as CompensationModel;
  const percentage = form.default_professor_percentage ?? "60";
  const fixedAmount = form.default_fixed_amount ?? "";

  // Previewed by the same engine that will apply at the till.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      financialApi
        .previewSplit({ amount: "100", model, percentage, fixed_amount: fixedAmount || undefined })
        .then((result) => !cancelled && setPreview(result))
        .catch(() => !cancelled && setPreview(null));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [model, percentage, fixedAmount]);

  useEffect(() => {
    if (!form.receipt_number_format) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      financialApi
        .previewReceiptFormat(form.receipt_number_format!)
        .then((result) => !cancelled && setReceiptSample(result.sample))
        .catch(() => !cancelled && setReceiptSample(""));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.receipt_number_format]);

  const set = (patch: Partial<FinancialSettings>) => {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
    setSaved(false);
  };

  const save = async () => {
    setError(null);
    try {
      await update.mutateAsync({
        academy_name: form.academy_name,
        academy_address: form.academy_address,
        academy_phone: form.academy_phone,
        currency: form.currency,
        currency_locale: form.currency_locale,
        default_compensation_model: form.default_compensation_model,
        default_professor_percentage: form.default_professor_percentage,
        default_fixed_amount: form.default_fixed_amount || null,
        receipt_number_format: form.receipt_number_format,
        payroll_receipt_format: form.payroll_receipt_format,
        settlement_receipt_format: form.settlement_receipt_format,
        due_soon_days: form.due_soon_days,
        late_grace_days: form.late_grace_days,
        late_fee_enabled: form.late_fee_enabled,
        late_fee_amount: form.late_fee_amount || null,
        academic_year_start_month: form.academic_year_start_month,
      });
      setDirty(false);
      setSaved(true);
    } catch (err) {
      const message =
        (err as any)?.response?.data?.error?.message ??
        (err as any)?.response?.data?.message ??
        (err as Error)?.message ??
        t("common.somethingWentWrong", "Something went wrong");
      setError(Array.isArray(message) ? message.join(", ") : String(message));
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-40 rounded-card bg-neutral-soft dark:bg-white/10 animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <ErrorState onRetry={refetch} className="py-16" />
      </div>
    );
  }

  const professorPct = Math.min(100, Math.max(0, Number(percentage) || 0));
  const professorBar = Math.min(100, Number(preview?.professor_share ?? 0));
  const schoolBar = Math.min(100, Number(preview?.school_share ?? 0));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div className="xl:col-span-2 space-y-6">
        <Section
          icon={Building2}
          title={t("financial.settings.academy", "Academy")}
          hint={t(
            "financial.settings.academyHint",
            "Printed on receipts and payroll settlement documents.",
          )}
        >
          <Field label={t("financial.settings.academyName", "Name")}>
            <input
              type="text"
              value={form.academy_name ?? ""}
              onChange={(e) => set({ academy_name: e.target.value })}
              className="input w-full"
            />
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label={t("financial.settings.academyAddress", "Address")}>
              <input
                type="text"
                value={form.academy_address ?? ""}
                onChange={(e) => set({ academy_address: e.target.value })}
                className="input w-full"
              />
            </Field>
            <Field label={t("financial.settings.academyPhone", "Phone")}>
              <input
                type="text"
                value={form.academy_phone ?? ""}
                onChange={(e) => set({ academy_phone: e.target.value })}
                className="input w-full"
              />
            </Field>
          </div>
        </Section>

        <Section
          icon={Calculator}
          title={t("financial.settings.revenue", "Revenue formula")}
          hint={t(
            "financial.settings.revenueHint",
            "The academy default. A professor with their own arrangement is not affected.",
          )}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label={t("financial.model", "Model")}>
              <select
                value={model}
                onChange={(e) => set({ default_compensation_model: e.target.value as CompensationModel })}
                className="input w-full text-sm"
              >
                {MODELS.map((option) => (
                  <option key={option} value={option}>
                    {t(`financial.models.${option}`, option.replace(/_/g, " "))}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`${t("financial.professorPercentage", "Professor percentage")} (%)`}>
              <input
                type="text"
                inputMode="decimal"
                value={percentage}
                onChange={(e) => set({ default_professor_percentage: e.target.value })}
                className="input w-full"
              />
            </Field>
          </div>
          <Field label={t("financial.fixedAmount", "Default fixed amount")}>
            <input
              type="text"
              inputMode="decimal"
              value={fixedAmount}
              onChange={(e) => set({ default_fixed_amount: e.target.value })}
              placeholder="—"
              className="input w-full"
            />
          </Field>
          <p className="text-xs text-text-secondary">
            {t(
              "financial.settings.liveRateNote",
              "Les paies ouvertes suivent le taux en vigueur : changer ce pourcentage recalcule immédiatement les paies non clôturées (modèles pourcentage / hybride).",
            )}
          </p>
        </Section>

        <Section
          icon={Banknote}
          title={t("financial.settings.currency", "Currency & payment methods")}
          hint={t("financial.settings.currencyHint", "The unit and number format printed on every money figure.")}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label={t("financial.settings.currencyCode", "Currency")}>
              <input
                type="text"
                value={form.currency ?? "TND"}
                onChange={(e) => set({ currency: e.target.value })}
                className="input w-full"
              />
            </Field>
            <Field label={t("financial.settings.locale", "Number format locale")}>
              <input
                type="text"
                value={form.currency_locale ?? "fr-TN"}
                onChange={(e) => set({ currency_locale: e.target.value })}
                className="input w-full"
              />
            </Field>
          </div>
          <Field label={t("financial.settings.methods", "Payment methods")}>
            <input type="text" value={t("financial.cashOnly", "Cash only")} disabled className="input w-full opacity-60" />
          </Field>
        </Section>

        <Section
          icon={ReceiptText}
          title={t("financial.settings.receipts", "Receipt numbering")}
          hint={t("financial.settings.receiptsHint", "How receipt and settlement numbers are built.")}
        >
          <Field label={t("financial.settings.paymentFormat", "Payment receipts")}>
            <input
              type="text"
              value={form.receipt_number_format ?? ""}
              onChange={(e) => set({ receipt_number_format: e.target.value })}
              className="input w-full font-mono text-sm"
            />
            <p className="text-xs text-text-secondary mt-1">
              {t("financial.settings.formatTokens", "Tokens: {YYYY} {YY} {MM} {SEQ}")}
              {receiptSample && ` · ${t("financial.settings.sample", "Sample")}: ${receiptSample}`}
            </p>
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label={t("financial.settings.payrollFormat", "Payroll receipts")}>
              <input
                type="text"
                value={form.payroll_receipt_format ?? ""}
                onChange={(e) => set({ payroll_receipt_format: e.target.value })}
                className="input w-full font-mono text-sm"
              />
            </Field>
            <Field label={t("financial.settings.settlementFormat", "Settlement reports")}>
              <input
                type="text"
                value={form.settlement_receipt_format ?? ""}
                onChange={(e) => set({ settlement_receipt_format: e.target.value })}
                className="input w-full font-mono text-sm"
              />
            </Field>
          </div>
        </Section>

        <Section
          icon={Clock}
          title={t("financial.settings.lateRules", "Late payment rules")}
          hint={t("financial.settings.lateRulesHint", "When invoices are flagged late and what a late invoice costs.")}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label={t("financial.settings.dueSoonDays", "Days before due to flag as due soon")}>
              <input
                type="number"
                min={0}
                max={31}
                value={form.due_soon_days ?? 2}
                onChange={(e) => set({ due_soon_days: Number(e.target.value) })}
                className="input w-full"
              />
            </Field>
            <Field label={t("financial.settings.graceDays", "Grace days after due date")}>
              <input
                type="number"
                min={0}
                max={90}
                value={form.late_grace_days ?? 0}
                onChange={(e) => set({ late_grace_days: Number(e.target.value) })}
                className="input w-full"
              />
            </Field>
          </div>
          <Field label={t("financial.settings.lateFee", "Late fee")}>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={form.late_fee_enabled ?? false}
                  onChange={(e) => set({ late_fee_enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-border"
                />
                {t("common.enabled", "Enabled")}
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={form.late_fee_amount ?? ""}
                onChange={(e) => set({ late_fee_amount: e.target.value })}
                disabled={!form.late_fee_enabled}
                placeholder="0.00"
                className="input flex-1 disabled:opacity-50"
              />
            </div>
          </Field>
        </Section>

        <Section
          icon={CalendarDays}
          title={t("financial.settings.academicYear", "Academic year")}
          hint={t("financial.settings.academicYearHint", "The month a new academic year starts — it defines the periods used everywhere.")}
        >
          <Field label={t("financial.settings.startMonth", "Year starts in")}>
            <select
              value={form.academic_year_start_month ?? 9}
              onChange={(e) => set({ academic_year_start_month: Number(e.target.value) })}
              className="input w-full text-sm md:max-w-[260px]"
            >
              {MONTHS.map((month) => (
                <option key={month} value={month}>
                  {new Date(2000, month - 1, 1).toLocaleDateString("fr-FR", { month: "long" })}
                </option>
              ))}
            </select>
          </Field>
        </Section>
      </div>

      <div className="space-y-6">
        <div className="card sticky top-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary shrink-0">
              <Calculator size={20} />
            </div>
            <div>
              <h3 className="text-h4 font-bold text-text-primary">
                {t("financial.settings.splitPreviewTitle", "Revenue split")}
              </h3>
              <p className="text-xs text-text-secondary">
                {t(
                  "financial.settings.splitPreviewHint",
                  "How a 100 DT payment is split between the professor and the academy, at the current defaults.",
                )}
              </p>
            </div>
          </div>

          {preview ? (
            <div className="space-y-4">
              <span className="inline-flex items-center rounded-full bg-neutral-soft px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                {t(`financial.models.${model}`, model.replace(/_/g, " "))}
                {model === "percentage" && ` · ${professorPct}%`}
                {fixedAmount && ` · ${formatCurrency(Number(fixedAmount))}`}
              </span>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-text-secondary">{t("financial.professorShare", "Professor")}</span>
                  <span className="font-medium tabular-nums text-gold-600 dark:text-gold-400">
                    {formatCurrency(preview.professor_share)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-neutral-soft overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gold-400 transition-all duration-300"
                    style={{ width: `${professorBar}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-text-secondary">{t("financial.schoolShare", "School")}</span>
                  <span className="font-medium tabular-nums text-primary">
                    {formatCurrency(preview.school_share)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-neutral-soft overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${schoolBar}%` }}
                  />
                </div>
              </div>

              <div className="rounded-btn border border-border bg-background p-3 text-xs text-text-secondary">
                {t("financial.preview", "On a 100 DT payment")}
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-btn bg-gold-50 dark:bg-gold-500/10 p-2.5 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-text-secondary">
                      {t("financial.professorShare", "Professor")}
                    </p>
                    <p className="mt-0.5 font-semibold tabular-nums text-gold-600 dark:text-gold-400">
                      {formatCurrency(preview.professor_share)}
                    </p>
                  </div>
                  <div className="rounded-btn bg-primary-50 dark:bg-primary/10 p-2.5 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-text-secondary">
                      {t("financial.schoolShare", "School")}
                    </p>
                    <p className="mt-0.5 font-semibold tabular-nums text-primary">
                      {formatCurrency(preview.school_share)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-text-secondary">—</p>
          )}
        </div>

        <div className="card space-y-3">
          {error && (
            <div className="flex items-start gap-2 rounded-btn bg-danger-soft text-danger-strong px-3 py-2 text-sm">
              <AlertCircle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            {dirty && (
              <span className="inline-flex items-center gap-1.5 text-xs text-gold-600 dark:text-gold-400">
                <span className="h-2 w-2 rounded-full bg-gold-400 animate-pulse" aria-hidden="true" />
                {t("financial.settings.unsaved", "Unsaved changes")}
              </span>
            )}
            {saved && !dirty && (
              <span className="inline-flex items-center gap-1.5 text-xs text-success-strong">
                <Check size={14} aria-hidden="true" />
                {t("common.saved", "Saved")}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={save}
            disabled={update.isPending || !dirty}
            className={cn("btn btn-primary w-full text-sm", !dirty && "disabled:opacity-40")}
          >
            <Save size={15} aria-hidden="true" />
            {update.isPending ? t("common.saving", "Saving…") : t("common.save", "Save changes")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary shrink-0">
          <Icon size={20} />
        </div>
        <div>
          <h3 className="text-h4 font-bold text-text-primary">{title}</h3>
          {hint && <p className="text-xs text-text-secondary">{hint}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-text-secondary block mb-1">{label}</label>
      {children}
    </div>
  );
}
