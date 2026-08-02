"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ChevronRight, FileText, Printer, Settings2, Wallet } from "lucide-react";
import { useProfessorFinancials, useProfessorDocuments, useRegenerateDocuments } from "@/hooks/use-financial";
import { ChartCard } from "@/components/financial/chart-card";
import { GroupedBarChart } from "@/components/financial/charts";
import { RecordPayrollModal } from "@/components/financial/record-payroll-modal";
import { CompensationModal } from "@/components/financial/compensation-modal";
import { SettlementDocumentsModal } from "@/components/financial/settlement-documents-modal";
import { openPayrollDocument, openReceipt } from "@/lib/api/financial.api";
import { payrollStatusClasses, SERIES } from "@/lib/charts/theme";
import { cn, formatCurrency, formatDate, formatPeriod } from "@/lib/utils/format";
import { useTranslation } from "@/lib/i18n/context";

/**
 * One professor's financial page: the arrangement in force, what this period
 * produced, the teaching load behind it, and every payout ever made to them.
 */
export default function ProfessorFinancialPage() {
  const { t } = useTranslation();
  const params = useParams<{ profId: string }>();
  const searchParams = useSearchParams();
  const profId = params.profId;

  const [period, setPeriod] = useState(searchParams.get("period") ?? "");
  const [payOpen, setPayOpen] = useState(false);
  const [compOpen, setCompOpen] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [settledPayout, setSettledPayout] = useState<string | undefined>(undefined);

  const { data, isLoading } = useProfessorFinancials(profId, period || undefined);
  const { data: documents } = useProfessorDocuments(profId, period || undefined);
  const regenerate = useRegenerateDocuments();

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

  const { professor, compensation, period: current, lifetime, assignments, payroll_history } = data;

  const breakdownSeries = [
    { key: "revenue", label: t("financial.revenueGenerated", "Revenue generated"), color: SERIES.revenue },
    { key: "earned", label: t("financial.payroll.earned", "Earned"), color: SERIES.professor },
    { key: "paid", label: t("financial.payroll.paid", "Paid"), color: SERIES.payroll },
  ];

  const monthly = data.monthly_breakdown.map((row) => ({ ...row, bucket: row.period }));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-text-secondary">
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
            <p className="text-xs text-text-secondary mt-1">
              {t("financial.compensationInForce", "Compensation")}:{" "}
              <span className="text-text-primary font-medium">
                {t(`financial.models.${compensation.model}`, compensation.model.replace(/_/g, " "))}
                {compensation.percentage && ` · ${compensation.percentage}%`}
                {compensation.fixed_amount && ` · ${formatCurrency(compensation.fixed_amount)}`}
              </span>
              {!compensation.is_override && (
                <span className="text-text-secondary"> ({t("financial.academyDefault", "academy default")})</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="month"
            aria-label={t("payments.period", "Period")}
            value={period || current.label}
            onChange={(e) => setPeriod(e.target.value)}
            className="input w-auto text-xs"
          />
          <button type="button" onClick={() => setCompOpen(true)} className="btn btn-secondary text-xs">
            <Settings2 size={14} aria-hidden="true" />
            {t("financial.editCompensation", "Compensation")}
          </button>
          <button
            type="button"
            onClick={() => {
              setSettledPayout(undefined);
              setSettlementOpen(true);
            }}
            className="btn btn-secondary text-xs"
          >
            <FileText size={14} aria-hidden="true" />
            {t("financial.settlementDocuments", "Settlement documents")}
          </button>
          <button
            type="button"
            onClick={() => setPayOpen(true)}
            disabled={Number(current.remaining_balance) <= 0}
            className="btn btn-primary text-xs disabled:opacity-40"
          >
            <Wallet size={14} aria-hidden="true" />
            {t("financial.recordPayroll", "Record payment")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label={t("financial.revenueGenerated", "Revenue generated")} value={formatCurrency(current.revenue_generated)} />
        <Tile label={t("financial.payroll.totalEarned", "Total earned")} value={formatCurrency(current.total_earned)} />
        <Tile label={t("financial.payroll.alreadyPaid", "Already paid")} value={formatCurrency(current.already_paid)} tone="positive" />
        <Tile
          label={t("financial.remainingBalance", "Remaining balance")}
          value={formatCurrency(current.remaining_balance)}
          tone={Number(current.remaining_balance) > 0 ? "danger" : "neutral"}
          badge={
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                payrollStatusClasses(current.status),
              )}
            >
              {t(`financial.payroll.${current.status}`, current.status)}
            </span>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-1">
          <h4 className="text-xs font-semibold text-text-secondary uppercase mb-3">
            {t("financial.earningsSplit", "This period")}
          </h4>
          <dl className="space-y-2 text-sm">
            <Row label={t("financial.fromCollections", "From collections")} value={formatCurrency(current.earned_from_collections)} />
            <Row label={t("financial.fixedComponent", "Fixed component")} value={formatCurrency(current.earned_fixed)} />
            <Row label={t("nav.students", "Students")} value={String(data.student_count)} />
            <Row label={t("nav.groups", "Groups")} value={String(data.group_count)} />
          </dl>

          <h4 className="text-xs font-semibold text-text-secondary uppercase mt-5 mb-3">
            {t("financial.lifetime", "Lifetime")}
          </h4>
          <dl className="space-y-2 text-sm">
            <Row label={t("financial.revenueGenerated", "Revenue generated")} value={formatCurrency(lifetime.revenue_generated)} />
            <Row label={t("financial.payroll.totalEarned", "Earned")} value={formatCurrency(lifetime.total_earned)} />
            <Row label={t("financial.payroll.alreadyPaid", "Paid")} value={formatCurrency(lifetime.already_paid)} />
            <Row label={t("financial.remainingBalance", "Balance")} value={formatCurrency(lifetime.remaining_balance)} />
          </dl>
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
            <GroupedBarChart data={monthly} series={breakdownSeries} />
          </ChartCard>
        </div>
      </div>

      <div className="card">
        <h4 className="text-xs font-semibold text-text-secondary uppercase mb-3">
          {t("financial.teachingAssignments", "Teaching assignments")}
        </h4>
        {assignments.length === 0 ? (
          <p className="text-sm text-text-secondary">{t("financial.noAssignments", "No active groups.")}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {assignments.map((assignment) => (
              <div key={assignment.id} className="rounded-btn border border-border p-3">
                <p className="text-sm font-medium text-text-primary">{assignment.name}</p>
                <p className="text-xs text-text-secondary mt-0.5">
                  {assignment.student_count} {t("nav.students", "students")}
                  {assignment.capacity ? ` / ${assignment.capacity}` : ""}
                </p>
                {assignment.schedule_notes && (
                  <p className="text-xs text-text-secondary mt-1">{assignment.schedule_notes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h4 className="text-xs font-semibold text-text-secondary uppercase mb-3">
          {t("financial.payrollHistory", "Payroll history")}
        </h4>
        {payroll_history.length === 0 ? (
          <p className="text-sm text-text-secondary">{t("financial.noPayroll", "Nothing paid to this professor yet.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary uppercase">
                    {t("payments.dueDate", "Date")}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary uppercase">
                    {t("payments.period", "Period")}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary uppercase">
                    {t("financial.receiptNumber", "Receipt")}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary uppercase">
                    {t("payments.notes", "Notes")}
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-text-secondary uppercase">
                    {t("payments.amount", "Amount")}
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payroll_history.map((payout) => {
                  const payoutDocs = (documents ?? []).filter((doc) => doc.payout_id === payout.id);
                  return (
                    <tr key={payout.id} className="hover:bg-background/50">
                      <td className="px-3 py-2 text-text-secondary">{formatDate(payout.paid_at)}</td>
                      <td className="px-3 py-2 text-text-secondary">
                        {payout.period ? formatPeriod(payout.period) : "—"}
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
                            aria-label={t("financial.printReceipt", "Print receipt")}
                            className="btn btn-secondary text-xs"
                          >
                            <Printer size={13} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const settlement = payoutDocs.find((doc) => doc.type === "school_settlement");
                              if (settlement) openPayrollDocument(settlement.id).catch(() => {});
                            }}
                            disabled={!payoutDocs.some((doc) => doc.type === "school_settlement")}
                            aria-label={t("financial.printSettlement", "Print settlement report")}
                            className="btn btn-secondary text-xs disabled:opacity-40"
                          >
                            <FileText size={13} aria-hidden="true" />
                          </button>
                          {payoutDocs.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setSettledPayout(payout.id);
                                setSettlementOpen(true);
                              }}
                              aria-label={t("financial.settlementDocuments", "Settlement documents")}
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

      <div className="card">
        <h4 className="text-xs font-semibold text-text-secondary uppercase mb-3">
          {t("financial.documentsHistory", "Settlement documents")}
        </h4>
        {!documents || documents.length === 0 ? (
          <p className="text-sm text-text-secondary">
            {t("financial.noDocuments", "No settlement documents yet — they are generated automatically with each payroll payment.")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary uppercase">
                    {t("payments.type", "Type")}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary uppercase">
                    {t("financial.receiptNumber", "No.")}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary uppercase">
                    {t("payments.period", "Period")}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary uppercase">
                    {t("financial.generatedOn", "Generated on")}
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {documents.map((doc) => (
                  <tr key={doc.id} className="hover:bg-background/50">
                    <td className="px-3 py-2 text-text-primary">{doc.title}</td>
                    <td className="px-3 py-2 text-text-secondary font-mono text-xs">{doc.document_no}</td>
                    <td className="px-3 py-2 text-text-secondary">
                      {doc.period ? formatPeriod(doc.period) : "—"}
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{formatDate(doc.generated_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => openPayrollDocument(doc.id).catch(() => {})}
                        aria-label={t("financial.printDocument", "Print document")}
                        className="btn btn-secondary text-xs"
                      >
                        <Printer size={13} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
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
            setSettledPayout(payout.id);
            setSettlementOpen(true);
          }}
        />
      )}

      {settlementOpen && (
        <SettlementDocumentsModal
          profId={profId}
          professorName={professor.full_name}
          period={current.label}
          payoutId={settledPayout}
          isOpen={settlementOpen}
          onClose={() => {
            setSettlementOpen(false);
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

function Tile({
  label,
  value,
  tone = "neutral",
  badge,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "danger";
  badge?: React.ReactNode;
}) {
  return (
    <div className="card py-3">
      <p className="text-xs text-text-secondary">{label}</p>
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
      {badge && <div className="mt-1.5">{badge}</div>}
    </div>
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
