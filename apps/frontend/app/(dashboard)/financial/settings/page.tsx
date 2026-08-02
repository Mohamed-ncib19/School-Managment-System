"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ImagePlus, Save, Trash2, Upload } from "lucide-react";
import { useFinancialSettings, useUpdateFinancialSettings, useUploadLogo, useRemoveLogo } from "@/hooks/use-financial";
import { financialApi } from "@/lib/api/financial.api";
import { apiBaseUrl } from "@/lib/api/client";
import { formatCurrency } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";
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
  const { data: settings, isLoading } = useFinancialSettings();
  const update = useUpdateFinancialSettings();
  const uploadLogo = useUploadLogo();
  const removeLogo = useRemoveLogo();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<Partial<FinancialSettings>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<{ professor_share: string; school_share: string } | null>(null);
  const [receiptSample, setReceiptSample] = useState("");

  const logoUrl = settings?.logo_path
    ? `${apiBaseUrl()}/financial/settings/logo?v=${new Date(settings.updated_at).getTime()}`
    : null;

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

  return (
    <div className="space-y-4 max-w-3xl">
      <Section title={t("financial.settings.academy", "Academy")}>
        <p className="text-xs text-text-secondary -mt-1 mb-3">
          {t(
            "financial.settings.academyHint",
            "Printed on receipts and payroll settlement documents.",
          )}
        </p>
        <Field label={t("financial.settings.academyName", "Name")}>
          <input
            type="text"
            value={form.academy_name ?? ""}
            onChange={(e) => set({ academy_name: e.target.value })}
            className="input w-full"
          />
        </Field>
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
      </Section>

      <Section title={t("financial.settings.logoTitle", "Logo")}>
        <p className="text-xs text-text-secondary -mt-1 mb-3">
          {t(
            "financial.settings.logoHint",
            "Printed on the settlement documents and receipts (header), shown in the sidebar and as the browser-tab icon.",
          )}
        </p>

        <div className="flex items-start gap-4">
          <div className="h-20 w-20 shrink-0 rounded-btn border border-border bg-background flex items-center justify-center overflow-hidden">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={form.academy_name ?? t("financial.settings.academyName", "Name")} className="h-full w-full object-contain" />
            ) : (
              <ImagePlus size={24} className="text-text-secondary" aria-hidden="true" />
            )}
          </div>

          <div className="flex-1 space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setError(null);
                uploadLogo.mutate(file, {
                  onError: (err) => setError((err as Error)?.message || t("common.somethingWentWrong", "Something went wrong")),
                });
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadLogo.isPending}
                className="btn btn-primary text-xs"
              >
                {uploadLogo.isPending ? <Upload size={13} className="animate-pulse" aria-hidden="true" /> : <Upload size={13} aria-hidden="true" />}
                {uploadLogo.isPending
                  ? t("financial.settings.uploading", "Uploading…")
                  : t("financial.settings.uploadLogo", "Upload logo")}
              </button>
              {logoUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    removeLogo.mutate(undefined, {
                      onError: (err) => setError((err as Error)?.message || t("common.somethingWentWrong", "Something went wrong")),
                    });
                  }}
                  disabled={removeLogo.isPending}
                  className="btn btn-secondary text-xs"
                >
                  <Trash2 size={13} aria-hidden="true" />
                  {t("financial.settings.removeLogo", "Remove")}
                </button>
              )}
            </div>
            <p className="text-[11px] text-text-secondary">
              {t(
                "financial.settings.logoFormat",
                "PNG, JPG or WebP — up to 2 MB. The file is served from the backend; the old one is deleted on replace.",
              )}
            </p>
          </div>
        </div>
      </Section>

      <Section title={t("financial.settings.revenue", "Revenue formula")}>
        <p className="text-xs text-text-secondary -mt-1 mb-3">
          {t(
            "financial.settings.revenueHint",
            "The academy default. A professor with their own arrangement is not affected.",
          )}
        </p>

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

        {preview && (
          <div className="rounded-btn border border-border bg-background p-3 mt-1">
            <p className="text-xs font-semibold text-text-secondary uppercase mb-2">
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
          </div>
        )}
      </Section>

      <Section title={t("financial.settings.currency", "Currency & payment methods")}>
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
        <Field label={t("financial.settings.methods", "Payment methods")}>
          <input type="text" value={t("financial.cashOnly", "Cash only")} disabled className="input w-full opacity-60" />
        </Field>
      </Section>

      <Section title={t("financial.settings.receipts", "Receipt numbering")}>
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
      </Section>

      <Section title={t("financial.settings.lateRules", "Late payment rules")}>
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
        <Field label={t("financial.settings.lateFee", "Late fee")}>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
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

      <Section title={t("financial.settings.academicYear", "Academic year")}>
        <Field label={t("financial.settings.startMonth", "Year starts in")}>
          <select
            value={form.academic_year_start_month ?? 9}
            onChange={(e) => set({ academic_year_start_month: Number(e.target.value) })}
            className="input w-full text-sm"
          >
            {MONTHS.map((month) => (
              <option key={month} value={month}>
                {new Date(2000, month - 1, 1).toLocaleDateString("en-US", { month: "long" })}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      {error && (
        <div className="flex items-start gap-2 rounded-btn bg-danger-soft text-danger-strong px-3 py-2 text-sm">
          <AlertCircle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        {saved && (
          <span className="inline-flex items-center gap-1.5 text-sm text-success-strong">
            <Check size={15} aria-hidden="true" />
            {t("common.saved", "Saved")}
          </span>
        )}
        <button type="button" onClick={save} disabled={update.isPending} className="btn btn-primary text-sm">
          <Save size={15} aria-hidden="true" />
          {update.isPending ? t("common.saving", "Saving…") : t("common.save", "Save changes")}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card space-y-3">
      <h3 className="text-sm font-bold text-text-primary">{title}</h3>
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
