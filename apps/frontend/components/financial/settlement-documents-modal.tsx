"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Check, CheckCircle2, ChevronDown, FileText, Printer, RefreshCw, X } from "lucide-react";
import { useProfessorDocuments, useRegenerateDocuments, useSettlement } from "@/hooks/use-financial";
import { openPayrollDocument } from "@/lib/api/financial.api";
import { cn, formatCurrency, formatDate, formatPeriod } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import type { RecordedPayout } from "./record-payroll-modal";

interface SettlementDocumentsModalProps {
  profId: string;
  professorName: string;
  period: string;
  payoutId?: string;
  /** The payout just recorded — shows the confirmation strip at the top. */
  payout?: RecordedPayout;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * The payroll settlement papers, shown the moment a payment is recorded.
 *
 * The two printable A4 documents — the professor's receipt and the school's
 * internal settlement report — and the three headline figures (earned, paid,
 * balance) are all a settlement screen has to put in front of the user. The
 * arithmetic behind them — revenue split, per-group breakdown, verification —
 * and the full document history stay one click away behind disclosure rows.
 */
export function SettlementDocumentsModal({
  profId,
  professorName,
  period,
  payoutId,
  payout,
  isOpen,
  onClose,
}: SettlementDocumentsModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
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

  const handleRegenerate = async () => {
    if (!payoutId) return;
    try {
      await regenerate.mutateAsync(payoutId);
      toast.success(
        t("financial.documentsRegenerated", "Documents régénérés"),
        t("financial.documentsRegeneratedSub", "Le reçu et le rapport de règlement ont été remis à jour."),
      );
    } catch {
      toast.error(t("financial.documentsRegenerateFailed", "Régénération impossible"),
        t("common.somethingWentWrong", "Une erreur est survenue. Réessayez."));
    }
  };

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
          {payout && (
            <div className="flex items-center gap-3 rounded-btn border border-success/30 bg-success-soft dark:bg-success-dark-soft px-4 py-3">
              <CheckCircle2 size={18} className="shrink-0 text-success-strong" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-text-primary">
                  {t("financial.payoutRecorded", "Versement enregistré")}
                </p>
                <p className="text-xs text-text-secondary mt-0.5 truncate">
                  {payout.receipt_number && (
                    <>
                      {t("financial.receiptNumber", "Reçu")} N&deg; {payout.receipt_number} &middot;{" "}
                    </>
                  )}
                  {formatCurrency(payout.amount)} &middot; {formatDate(payout.paid_at)}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success-strong dark:bg-success-dark-soft dark:text-success-dark-strong">
                {formatPeriod(period)}
              </span>
            </div>
          )}

          {isLoading || !settlement ? (
            <div className="space-y-3">
              <div className="h-32 rounded-btn bg-neutral-soft dark:bg-white/10 animate-pulse" />
              <div className="h-16 rounded-btn bg-neutral-soft dark:bg-white/10 animate-pulse" />
              <div className="h-24 rounded-btn bg-neutral-soft dark:bg-white/10 animate-pulse" />
            </div>
          ) : (
            <>
              <div>
                <h4 className="text-xs font-semibold text-text-secondary uppercase mb-2">
                  {t("financial.printSection", "Documents à imprimer")}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <PrintCard
                    icon={<FileText size={16} />}
                    title={t("financial.professorReceiptDoc", "Reçu du professeur")}
                    subtitle={t("financial.professorReceiptDocSub", "Remis au professeur — reçu officiel")}
                    no={sorted.find((d) => d.type === "professor_receipt")?.document_no ?? settlement.document.no}
                    available={sorted.some((d) => d.type === "professor_receipt")}
                    onPrint={() => {
                      const doc = sorted.find((d) => d.type === "professor_receipt");
                      if (doc) reprint(doc.id);
                    }}
                  />
                  <PrintCard
                    icon={<FileText size={16} />}
                    title={t("financial.schoolSettlementDoc", "Rapport de règlement")}
                    subtitle={t("financial.schoolSettlementDocSub", "Interne — réservé à l'académie")}
                    no={sorted.find((d) => d.type === "school_settlement")?.document_no ?? "—"}
                    available={sorted.some((d) => d.type === "school_settlement")}
                    onPrint={() => {
                      const doc = sorted.find((d) => d.type === "school_settlement");
                      if (doc) reprint(doc.id);
                    }}
                  />
                </div>
              </div>

              <div className="rounded-btn border border-border overflow-hidden">
                <div className="grid grid-cols-3 divide-x divide-border">
                  <StatBlock
                    label={t("financial.payroll.totalEarned", "Total acquis")}
                    value={formatCurrency(settlement.totals.total_earned)}
                  />
                  <StatBlock
                    label={t("financial.payroll.alreadyPaid", "Déjà versé")}
                    value={formatCurrency(settlement.totals.amount_paid)}
                    tone="positive"
                  />
                  <StatBlock
                    label={t("financial.remainingBalance", "Solde")}
                    value={formatCurrency(settlement.totals.remaining_balance)}
                    tone={Number(settlement.totals.remaining_balance) > 0 ? "danger" : "neutral"}
                  />
                </div>
              </div>

              <Disclosure
                title={t("financial.settlementDetails", "Détails du calcul")}
                badge={
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
                      verified
                        ? "border-success/30 bg-success-soft text-success-strong dark:bg-success-dark-soft dark:text-success-dark-strong"
                        : "border-danger/30 bg-danger-soft text-danger-strong dark:bg-danger-dark-soft dark:text-danger-dark-strong",
                    )}
                  >
                    {verified ? <Check size={12} aria-hidden="true" /> : <AlertCircle size={12} aria-hidden="true" />}
                    {verified
                      ? t("financial.breakdownVerified", "Répartition vérifiée")
                      : t("financial.breakdownMismatch", "Écart de répartition")}
                  </span>
                }
              >
                <div className="text-center mb-3">
                  <p className="text-xs text-text-secondary">
                    {t("financial.totalStudentRevenue", "Revenu total des étudiants")}
                  </p>
                  <p className="text-h4 font-bold text-text-primary tabular-nums">
                    {formatCurrency(settlement.totals.revenue)}
                  </p>
                  <p className="text-xs text-text-secondary mt-1">↓</p>
                </div>

                <div className="flex items-end justify-between gap-4 mb-2">
                  <div className="text-center flex-1">
                    <p className="text-xs text-text-secondary">{t("financial.professorShare", "Part professeur")}</p>
                    <p className="text-lg font-bold text-primary tabular-nums">
                      {formatCurrency(settlement.totals.professor_share)}
                    </p>
                  </div>
                  <div className="text-xs text-text-secondary pb-1">+</div>
                  <div className="text-center flex-1">
                    <p className="text-xs text-text-secondary">{t("financial.schoolShare", "Part école")}</p>
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
                  {professorPct}% {t("financial.payroll.professor", "professeur")} · {academyPct}%{" "}
                  {t("financial.payroll.academy", "académie")}
                </p>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3 text-xs">
                  <Row label={t("financial.payroll.earned", "Acquis")} value={formatCurrency(settlement.totals.total_earned)} />
                  <Row label={t("financial.payroll.paid", "Versé")} value={formatCurrency(settlement.totals.amount_paid)} />
                  <Row label={t("financial.payroll.students", "Étudiants inclus")} value={String(settlement.totals.student_count)} />
                  <Row label={t("financial.formula", "Formule")} value={settlement.formula.description} />
                  <Row
                    label={t("financial.remainingBalance", "Solde restant")}
                    value={formatCurrency(settlement.totals.remaining_balance)}
                    tone={Number(settlement.totals.remaining_balance) > 0 ? "danger" : "neutral"}
                  />
                </dl>

                {settlement.groups.length > 0 && (
                  <div className="mt-3 rounded-btn border border-border overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="bg-background">
                            <th className="px-3 py-2 text-left font-semibold text-text-secondary uppercase">{t("nav.groups", "Groupe")}</th>
                            <th className="px-3 py-2 text-right font-semibold text-text-secondary uppercase">{t("nav.students", "Étudiants")}</th>
                            <th className="px-3 py-2 text-right font-semibold text-text-secondary uppercase">{t("financial.revenueGenerated", "Revenus")}</th>
                            <th className="px-3 py-2 text-right font-semibold text-text-secondary uppercase">{t("financial.professorShare", "Professeur")}</th>
                            <th className="px-3 py-2 text-right font-semibold text-text-secondary uppercase">{t("financial.schoolShare", "École")}</th>
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
              </Disclosure>

              {sorted.length > 0 && (
                <Disclosure title={t("financial.documentHistory", "Historique des documents")}>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="text-xs text-text-secondary">
                      {t("financial.documentHistorySub", "Tous les documents générés pour ce professeur.")}
                    </p>
                    {payoutId && (
                      <button
                        type="button"
                        onClick={handleRegenerate}
                        disabled={regenerate.isPending}
                        className="btn btn-secondary text-xs shrink-0"
                      >
                        <RefreshCw size={12} aria-hidden="true" />
                        {regenerate.isPending
                          ? t("financial.regeneratingDocuments", "Régénération…")
                          : t("financial.regenerateDocuments", "Régénérer")}
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
                                aria-label={t("financial.printDocument", "Imprimer le document")}
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
                </Disclosure>
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

/**
 * Collapsed by default: the printed documents and the headline figures are the
 * point of this screen — the arithmetic that produced them is one click away.
 */
function Disclosure({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-btn border border-border">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-background/50 transition-colors"
      >
        <span className="text-xs font-semibold text-text-primary uppercase">{title}</span>
        <span className="inline-flex items-center gap-2">
          {badge}
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={cn("text-text-secondary transition-transform duration-150", open && "rotate-180")}
          />
        </span>
      </button>
      {open && <div className="border-t border-border p-4">{children}</div>}
    </div>
  );
}

function StatBlock({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "danger";
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p
        className={cn(
          "text-h4 font-bold tabular-nums mt-0.5",
          tone === "positive" && "text-success-strong",
          tone === "danger" && "text-danger-strong",
          tone === "neutral" && "text-text-primary",
        )}
      >
        {value}
      </p>
    </div>
  );
}
