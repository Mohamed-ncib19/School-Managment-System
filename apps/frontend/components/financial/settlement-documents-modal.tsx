"use client";

import { useMemo } from "react";
import { AlertCircle, Check, FileText, Printer, RefreshCw, X } from "lucide-react";
import { useProfessorDocuments, useRegenerateDocuments, useSettlement } from "@/hooks/use-financial";
import { openPayrollDocument } from "@/lib/api/financial.api";
import { cn, formatCurrency, formatDate, formatPeriod } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";

interface SettlementDocumentsModalProps {
  profId: string;
  professorName: string;
  period: string;
  payoutId?: string;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * The payroll settlement papers, shown the moment a payment is recorded.
 *
 * Reproduces the academy's manual workbook on screen: total student revenue
 * split into professor share + school share, verified to add back to exactly
 * 100%, with the two printable A4 documents — the professor's receipt and the
 * school's internal settlement report — one click away, and every document ever
 * minted for this professor reprintable below.
 */
export function SettlementDocumentsModal({
  profId,
  professorName,
  period,
  payoutId,
  isOpen,
  onClose,
}: SettlementDocumentsModalProps) {
  const { t } = useTranslation();
  const { data: settlement, isLoading } = useSettlement(profId, period, isOpen);
  const { data: documents } = useProfessorDocuments(profId, period, isOpen);
  const regenerate = useRegenerateDocuments();

  const sorted = useMemo(
    () =>
      (documents ?? []).slice().sort(
        (a, b) =>
          new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime(),
      ),
    [documents],
  );

  if (!isOpen) return null;

  const revenue = Number(settlement?.verification.revenue ?? 0);
  const professorPct = revenue > 0
    ? Math.min(100, Math.max(0, Math.round(((Number(settlement?.verification.professor_share ?? 0) / revenue) * 100) * 10) / 10))
    : 0;
  const academyPct = Math.round((100 - professorPct) * 10) / 10;

  const verified = settlement?.verification.verified ?? false;

  const printDocument = async (docId: string) => {
    try {
      await openPayrollDocument(docId);
    } catch {
      // popup blocked — nothing to do, the button simply had no effect
    }
  };

  const reprint = (id: string) => printDocument(id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("financial.settlementDocuments", "Settlement documents")}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-surface rounded-modal shadow-modal w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div>
            <h3 className="text-sm font-bold text-text-primary">
              {t("financial.settlementDocuments", "Settlement documents")}
            </h3>
            <p className="text-xs text-text-secondary mt-0.5">
              {professorName} &middot; {formatPeriod(period)}
            </p>
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

        <div className="p-5 overflow-y-auto space-y-5">
          {isLoading || !settlement ? (
            <div className="space-y-3">
              <div className="h-24 rounded-btn bg-neutral-soft dark:bg-white/10 animate-pulse" />
              <div className="h-40 rounded-btn bg-neutral-soft dark:bg-white/10 animate-pulse" />
            </div>
          ) : (
            <>
              <div className="rounded-btn border border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-text-secondary uppercase">
                    {t("financial.revenueBreakdown", "Revenue breakdown")}
                  </h4>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
                      verified
                        ? "border-success/30 bg-success-soft text-success-strong"
                        : "border-danger/30 bg-danger-soft text-danger-strong",
                    )}
                  >
                    {verified ? <Check size={12} aria-hidden="true" /> : <AlertCircle size={12} aria-hidden="true" />}
                    {verified
                      ? t("financial.breakdownVerified", "Split verified")
                      : t("financial.breakdownMismatch", "Split mismatch")}
                  </span>
                </div>

                <div className="text-center mb-3">
                  <p className="text-xs text-text-secondary">
                    {t("financial.totalStudentRevenue", "Total student revenue")}
                  </p>
                  <p className="text-h4 font-bold text-text-primary tabular-nums">
                    {formatCurrency(settlement.totals.revenue)}
                  </p>
                  <p className="text-xs text-text-secondary mt-1">↓</p>
                </div>

                <div className="flex items-end justify-between gap-4 mb-2">
                  <div className="text-center flex-1">
                    <p className="text-xs text-text-secondary">{t("financial.professorShare", "Professor share")}</p>
                    <p className="text-lg font-bold text-primary tabular-nums">
                      {formatCurrency(settlement.totals.professor_share)}
                    </p>
                  </div>
                  <div className="text-xs text-text-secondary pb-1">+</div>
                  <div className="text-center flex-1">
                    <p className="text-xs text-text-secondary">{t("financial.schoolShare", "School share")}</p>
                    <p className="text-lg font-bold text-text-primary tabular-nums">
                      {formatCurrency(settlement.totals.school_share)}
                    </p>
                  </div>
                  <div className="text-xs text-text-secondary pb-1">=</div>
                  <div className="text-center flex-1">
                    <p className="text-xs text-text-secondary">{t("financial.total", "Total")}</p>
                    <p className="text-lg font-bold text-text-primary tabular-nums">
                      {formatCurrency(settlement.totals.revenue)}
                    </p>
                  </div>
                </div>

                <div className="h-2.5 rounded-full bg-neutral-soft dark:bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${professorPct}%` }}
                    title={`${professorPct}%`}
                  />
                </div>
                <p className="text-[11px] text-text-secondary mt-1 text-right">
                  {professorPct}% {t("financial.payroll.professor", "professor")} · {academyPct}%{" "}
                  {t("financial.payroll.academy", "academy")}
                </p>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3 text-xs">
                  <Row label={t("financial.payroll.earned", "Earned")} value={formatCurrency(settlement.totals.total_earned)} />
                  <Row label={t("financial.payroll.paid", "Paid")} value={formatCurrency(settlement.totals.amount_paid)} />
                  <Row label={t("financial.payroll.students", "Students included")} value={String(settlement.totals.student_count)} />
                  <Row label={t("financial.formula", "Formula")} value={settlement.formula.description} />
                  <Row
                    label={t("financial.remainingBalance", "Remaining balance")}
                    value={formatCurrency(settlement.totals.remaining_balance)}
                    tone={Number(settlement.totals.remaining_balance) > 0 ? "danger" : "neutral"}
                  />
                </dl>
              </div>

              {settlement.groups.length > 0 && (
                <div className="rounded-btn border border-border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="bg-background">
                          <th className="px-3 py-2 text-left font-semibold text-text-secondary uppercase">{t("nav.groups", "Group")}</th>
                          <th className="px-3 py-2 text-right font-semibold text-text-secondary uppercase">{t("nav.students", "Students")}</th>
                          <th className="px-3 py-2 text-right font-semibold text-text-secondary uppercase">{t("financial.revenueGenerated", "Revenue")}</th>
                          <th className="px-3 py-2 text-right font-semibold text-text-secondary uppercase">{t("financial.professorShare", "Professor")}</th>
                          <th className="px-3 py-2 text-right font-semibold text-text-secondary uppercase">{t("financial.schoolShare", "School")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {settlement.groups.map((group) => (
                          <tr key={group.group}>
                            <td className="px-3 py-2 text-text-primary">{group.group}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{group.students}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(group.revenue)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-primary">{formatCurrency(group.professor_share)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(group.school_share)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <PrintCard
                  icon={<FileText size={16} />}
                  title={t("financial.professorReceiptDoc", "Professor payment receipt")}
                  subtitle={t("financial.professorReceiptDocSub", "Given to the professor — official payroll receipt")}
                  no={sorted.find((d) => d.type === "professor_receipt")?.document_no ?? settlement.document.no}
                  available={sorted.some((d) => d.type === "professor_receipt")}
                  onPrint={() => {
                    const doc = sorted.find((d) => d.type === "professor_receipt");
                    if (doc) reprint(doc.id);
                  }}
                />
                <PrintCard
                  icon={<FileText size={16} />}
                  title={t("financial.schoolSettlementDoc", "School settlement report")}
                  subtitle={t("financial.schoolSettlementDocSub", "Internal — for the academy only")}
                  no={sorted.find((d) => d.type === "school_settlement")?.document_no ?? "—"}
                  available={sorted.some((d) => d.type === "school_settlement")}
                  onPrint={() => {
                    const doc = sorted.find((d) => d.type === "school_settlement");
                    if (doc) reprint(doc.id);
                  }}
                />
              </div>

              {sorted.length > 0 && (
                <div className="rounded-btn border border-border overflow-hidden">
                  <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-text-secondary uppercase">
                      {t("financial.documentsHistory", "Documents history")}
                    </h4>
                    {payoutId && (
                      <button
                        type="button"
                        onClick={() => regenerate.mutate(payoutId)}
                        disabled={regenerate.isPending}
                        className="btn btn-secondary text-xs"
                      >
                        <RefreshCw size={12} aria-hidden="true" />
                        {t("financial.regenerateDocuments", "Regenerate")}
                      </button>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <tbody className="divide-y divide-border">
                        {sorted.map((doc) => (
                          <tr key={doc.id} className="hover:bg-background/50">
                            <td className="px-3 py-2">
                              <span className="inline-flex items-center gap-1.5 text-text-primary font-medium">
                                <FileText size={12} className="text-primary" aria-hidden="true" />
                                {doc.title}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-text-secondary font-mono">{doc.document_no}</td>
                            <td className="px-3 py-2 text-text-secondary">{formatDate(doc.generated_at)}</td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => reprint(doc.id)}
                                aria-label={t("financial.printDocument", "Print document")}
                                className="btn btn-secondary text-xs"
                              >
                                <Printer size={12} aria-hidden="true" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-border">
          <button type="button" onClick={onClose} className="btn btn-secondary text-xs">
            {t("common.close", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function PrintCard({
  icon,
  title,
  subtitle,
  no,
  available,
  onPrint,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  no: string;
  available: boolean;
  onPrint: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-btn border border-border p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-primary">{icon}</span>
        <div>
          <p className="text-xs font-semibold text-text-primary">{title}</p>
          <p className="text-[11px] text-text-secondary">
            {available ? subtitle : t("financial.docAvailableAfterSettlement", "Generated when the payment is recorded")}
          </p>
        </div>
      </div>
      <p className="text-[11px] text-text-secondary font-mono">
        {t("financial.receiptNumber", "No.")}: {no || "—"}
      </p>
      <button type="button" onClick={onPrint} disabled={!available} className="btn btn-primary text-xs mt-auto disabled:opacity-40 disabled:cursor-not-allowed">
        <Printer size={13} aria-hidden="true" />
        {t("financial.printPdf", "Print / PDF")}
      </button>
    </div>
  );
}

function Row({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "danger";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-text-secondary">{label}</dt>
      <dd className={cn("text-text-primary font-medium tabular-nums", tone === "danger" && "text-danger-strong")}>
        {value}
      </dd>
    </div>
  );
}
