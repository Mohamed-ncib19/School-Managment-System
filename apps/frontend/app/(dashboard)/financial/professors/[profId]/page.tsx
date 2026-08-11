"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronRight, FileText, Printer, Settings2, Wallet } from "lucide-react";
import { useProfessorFinancials, useProfessorDocuments } from "@/hooks/use-financial";
import { ChartCard } from "@/components/financial/chart-card";
import { GroupedBarChart } from "@/components/financial/charts";
import { RecordPayrollModal, type RecordedPayout } from "@/components/financial/record-payroll-modal";
import { CompensationModal } from "@/components/financial/compensation-modal";
import { ErrorState } from "@/components/financial/error-state";
import { SettlementDocumentsModal } from "@/components/financial/settlement-documents-modal";
import { SummaryTile } from "@/components/financial/summary-tile";
import { openReceipt } from "@/lib/api/financial.api";
import { payrollStatusClasses, SERIES } from "@/lib/charts/theme";
import { cn, formatCurrency, formatDate, formatPeriod } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";

/**
 * One professor's financial page: the arrangement in force, what this period
 * produced, and every payout ever made to them.
 */
export default function ProfessorFinancialPage() {
  const { t } = useTranslation();
  const params = useParams<{ profId: string }>();
  const searchParams = useSearchParams();
  const profId = params.profId;

  const [period, setPeriod] = useState(searchParams.get("period") ?? "");
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [payOpen, setPayOpen] = useState(false);
  const [compOpen, setCompOpen] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [settledPayoutId, setSettledPayoutId] = useState<string | undefined>(undefined);
  const [settledPayout, setSettledPayout] = useState<RecordedPayout | undefined>(undefined);

  const { data, isLoading, isError, refetch } = useProfessorFinancials(profId, period || undefined);
  const { data: documents } = useProfessorDocuments(profId, period || undefined);

  const groups = useMemo(() => {
    if (!data?.assignments) return [];
    return data.assignments.map((a) => ({ id: a.id, name: a.name }));
  }, [data?.assignments]);

  const selectedGroupBreakdown = useMemo(() => {
    if (!selectedGroup || !data?.group_breakdown) return null;
    return data.group_breakdown.find((g) => g.group === selectedGroup) ?? null;
  }, [selectedGroup, data?.group_breakdown]);

  const displayedBreakdown = selectedGroup ? selectedGroupBreakdown : null;

  if (isError) {
    return (
      <div className="space-y-4">
        <ErrorState onRetry={refetch} className="py-16" />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <div className="h-24 rounded-card bg-neutral-soft dark:bg-white/10 animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 rounded-card bg-neutral-soft dark:bg-white/10 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const { professor, compensation, period: current, payroll_history, group_breakdown } = data;

  const breakdownSeries = [
    { key: "revenue", label: t("financial.revenueGenerated", "Revenue generated"), color: SERIES.revenue },
    { key: "earned", label: t("financial.payroll.earned", "Earned"), color: SERIES.professor },
    { key: "paid", label: t("financial.payroll.paid", "Paid"), color: SERIES.payroll },
  ];

  const monthly = data.monthly_breakdown.map((row) => ({ ...row, bucket: row.period }));
  const monthlySignature = monthly
    .map((row) => `${row.period}|${row.revenue}|${row.earned}|${row.paid}`)
    .join(",");

  const periodEarned = Number(current.total_earned);
  const collectionsPct =
    periodEarned > 0 ? Math.min(100, (Number(current.earned_from_collections) / periodEarned) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Link href="/financial" className="inline-flex items-center gap-1.5 hover:text-primary">
          <ArrowLeft size={15} aria-hidden="true" />
          {t("nav.financialManagement", "Gestion financière")}
        </Link>
        <ChevronRight size={14} aria-hidden="true" />
        <Link href="/financial/professors" className="hover:text-primary">
          {t("financial.nav.professorPayments", "Professor Payments")}
        </Link>
        <ChevronRight size={14} aria-hidden="true" />
        <span className="text-text-primary font-medium">{professor.full_name}</span>
      </div>

      <div className="card flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-primary-50 text-primary flex items-center justify-center font-bold">
            {professor.full_name
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div>
            <h3 className="text-sm font-bold text-text-primary">{professor.full_name}</h3>
            <p className="text-xs text-text-secondary">
              {professor.level?.name ?? "—"} &middot; {professor.field?.name ?? "—"} &middot; {professor.phone}
            </p>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-text-secondary mt-1.5">
              <Settings2 size={12} className="shrink-0" aria-hidden="true" />
              <span className="font-medium text-text-primary">
                {t(`financial.models.${compensation.model}`, compensation.model.replace(/_/g, " "))}
                {compensation.percentage && ` · ${compensation.percentage}%`}
                {compensation.fixed_amount && ` · ${formatCurrency(compensation.fixed_amount)}`}
              </span>
              {!compensation.is_override && (
                <span>· {t("financial.academyDefault", "défaut de l'académie")}</span>
              )}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setCompOpen(true)} className="btn btn-secondary text-xs">
            <Settings2 size={14} aria-hidden="true" />
            {t("financial.editCompensationAction", "Modifier la rémunération")}
          </button>
          <button
            type="button"
            onClick={() => {
              setSettledPayoutId(undefined);
              setSettledPayout(undefined);
              setSettlementOpen(true);
            }}
            className="btn btn-secondary text-xs"
          >
            <FileText size={14} aria-hidden="true" />
            {t("financial.settlementDocuments", "Documents de règlement")}
          </button>
          <button
            type="button"
            onClick={() => setPayOpen(true)}
            disabled={Number(current.remaining_balance) <= 0}
            className="btn btn-primary text-xs disabled:opacity-40"
          >
            <Wallet size={14} aria-hidden="true" />
            {t("financial.recordPayroll", "Enregistrer un versement")}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <label htmlFor="prof-period" className="text-xs font-medium text-text-secondary">
            {t("payments.period", "Période")}
          </label>
          <input
            id="prof-period"
            type="month"
            aria-label={t("payments.period", "Période")}
            value={period || current.label}
            onChange={(e) => setPeriod(e.target.value)}
            className="input w-auto text-xs"
          />
          <label htmlFor="prof-group" className="text-xs font-medium text-text-secondary ml-2">
            {t("nav.groups", "Groupe")}
          </label>
          <select
            id="prof-group"
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            className="input w-auto min-w-[160px] text-xs"
          >
            <option value="">{t("financial.groupBreakdown.allGroups", "Tous les groupes")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.name}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
            payrollStatusClasses(current.status),
          )}
        >
          {t(`financial.payroll.${current.status}`, current.status)}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <SummaryTile label={t("financial.revenueGenerated", "Revenus")} value={formatCurrency(current.revenue_generated)} />
        <SummaryTile
          label={t("financial.payroll.alreadyPaid", "Déjà versé")}
          value={formatCurrency(current.already_paid)}
          tone="positive"
        />
        <SummaryTile
          label={t("financial.remainingBalance", "Solde")}
          value={formatCurrency(current.remaining_balance)}
          tone={Number(current.remaining_balance) > 0 ? "danger" : "neutral"}
        />
      </div>

      {displayedBreakdown && (
        <div className="card">
          <h4 className="text-xs font-semibold text-text-secondary uppercase mb-3">
            {t("financial.groupBreakdown.title", "Répartition par groupe")} — {selectedGroup}
          </h4>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <Th>{t("nav.groups", "Groupe")}</Th>
                  <Th right>{t("nav.students", "Étudiants")}</Th>
                  <Th right>{t("financial.revenueGenerated", "Revenu")}</Th>
                  <Th right>{t("financial.payroll.earned", "Acquis")}</Th>
                  <Th right>{t("financial.schoolShare", "Part école")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr className="font-medium">
                  <td className="px-3 py-2.5">{selectedGroup}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{displayedBreakdown.students}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(displayedBreakdown.revenue)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                    {formatCurrency(displayedBreakdown.professor_share)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(displayedBreakdown.school_share)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!selectedGroup && group_breakdown && group_breakdown.length > 1 && (
        <div className="card">
          <h4 className="text-xs font-semibold text-text-secondary uppercase mb-3">
            {t("financial.groupBreakdown.title", "Répartition par groupe")}
          </h4>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <Th>{t("nav.groups", "Groupe")}</Th>
                  <Th right>{t("nav.students", "Étudiants")}</Th>
                  <Th right>{t("financial.revenueGenerated", "Revenu")}</Th>
                  <Th right>{t("financial.payroll.earned", "Acquis")}</Th>
                  <Th right>{t("financial.schoolShare", "Part école")}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {group_breakdown.map((row) => (
                  <tr
                    key={row.group}
                    className="hover:bg-background/50 cursor-pointer transition-colors"
                    onClick={() => setSelectedGroup(row.group)}
                  >
                    <td className="px-3 py-2.5 font-medium">{row.group}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.students}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(row.revenue)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                      {formatCurrency(row.professor_share)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(row.school_share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-4 lg:col-span-1">
          <div className="card">
            <h4 className="text-xs font-semibold text-text-secondary uppercase">
              {t("financial.earningsSplit", "Cette période")}
            </h4>
            <p className="text-xs text-text-secondary mt-0.5 mb-3">
              {t("financial.earningsSplitSub", "Comment se compose le montant acquis")}
            </p>

            <dl className="space-y-2 text-sm">
              <Row label={t("financial.fromCollections", "Sur encaissements")} value={formatCurrency(current.earned_from_collections)} />
              <Row label={t("financial.fixedComponent", "Part fixe")} value={formatCurrency(current.earned_fixed)} />
            </dl>

            <div className="mt-3 h-2.5 rounded-full bg-neutral-soft dark:bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${collectionsPct}%` }}
                title={`${Math.round(collectionsPct)}%`}
              />
            </div>

            <div className="mt-4 pt-3 border-t border-border">
              <dl className="space-y-2 text-sm">
                <Row label={t("nav.students", "Étudiants")} value={String(data.student_count)} />
                <Row label={t("nav.groups", "Groupes")} value={String(data.group_count)} />
              </dl>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <ChartCard
            title={t("financial.monthlyBreakdown", "Monthly breakdown")}
            subtitle={t("financial.monthlyBreakdownSub", "Revenue generated, earned and paid")}
            series={breakdownSeries}
            tableRows={monthly}
            loading={false}
            isEmpty={monthly.length === 0}
          >
            <GroupedBarChart key={monthlySignature} data={monthly} series={breakdownSeries} />
          </ChartCard>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <h4 className="text-xs font-semibold text-text-secondary uppercase">
            {t("financial.payrollHistory", "Historique de paie")}
          </h4>
          {payroll_history.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-neutral-soft px-2 py-0.5 text-[10px] font-medium text-text-secondary">
              {payroll_history.length}
            </span>
          )}
        </div>
        {payroll_history.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-text-secondary">
              {t("financial.noPayroll", "Aucun versement à ce professeur pour l'instant.")}
            </p>
            {Number(current.remaining_balance) > 0 && (
              <button type="button" onClick={() => setPayOpen(true)} className="btn btn-primary text-xs">
                <Wallet size={14} aria-hidden="true" />
                {t("financial.recordPayroll", "Enregistrer un versement")}
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary uppercase">
                    {t("payments.dueDate", "Date")}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary uppercase">
                    {t("financial.receiptNumber", "Reçu")}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary uppercase">
                    {t("payments.notes", "Notes")}
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-text-secondary uppercase">
                    {t("payments.amount", "Montant")}
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payroll_history.map((payout) => {
                  const payoutDocs = (documents ?? []).filter((doc) => doc.payout_id === payout.id);
                  return (
                    <tr key={payout.id} className="hover:bg-background/50">
                      <td className="px-3 py-2">
                        <span className="text-text-primary">{formatDate(payout.paid_at)}</span>
                        {payout.period && (
                          <span className="block text-xs text-text-secondary mt-0.5">{formatPeriod(payout.period)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-text-secondary font-mono text-xs">
                        {payout.receipt_number ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{payout.notes ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(payout.amount)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openReceipt("payroll", payout.id).catch(() => {})}
                            aria-label={t("financial.printReceipt", "Imprimer le reçu")}
                            title={t("financial.printReceipt", "Imprimer le reçu")}
                            className="btn btn-secondary text-xs"
                          >
                            <Printer size={13} aria-hidden="true" />
                          </button>
                          {payoutDocs.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setSettledPayoutId(payout.id);
                                setSettledPayout(undefined);
                                setSettlementOpen(true);
                              }}
                              aria-label={t("financial.settlementDocuments", "Documents de règlement")}
                              title={t("financial.settlementDocuments", "Documents de règlement")}
                              className="btn btn-secondary text-xs"
                            >
                              <FileText size={13} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {payOpen && (
        <RecordPayrollModal
          profId={profId}
          professorName={professor.full_name}
          period={current.label}
          outstanding={current.remaining_balance}
          isOpen={payOpen}
          onClose={() => setPayOpen(false)}
          onSettled={(payout) => {
            setSettledPayoutId(payout.id);
            setSettledPayout(payout);
            setSettlementOpen(true);
          }}
        />
      )}

      {settlementOpen && (
        <SettlementDocumentsModal
          profId={profId}
          professorName={professor.full_name}
          period={current.label}
          payoutId={settledPayoutId}
          payout={settledPayout}
          isOpen={settlementOpen}
          onClose={() => {
            setSettlementOpen(false);
            setSettledPayoutId(undefined);
            setSettledPayout(undefined);
          }}
        />
      )}

      {compOpen && (
        <CompensationModal
          profId={profId}
          professorName={professor.full_name}
          current={compensation}
          studentCount={data.student_count}
          groupCount={data.group_count}
          isOpen={compOpen}
          onClose={() => setCompOpen(false)}
        />
      )}
    </div>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={cn(
        "px-3 py-2.5 text-left text-xs font-semibold text-text-secondary uppercase whitespace-nowrap",
        right && "text-right",
      )}
    >
      {children}
    </th>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="text-text-primary font-medium tabular-nums">{value}</dd>
    </div>
  );
}
