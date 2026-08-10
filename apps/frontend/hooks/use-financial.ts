"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { financialApi, type FinancialFilters } from "@/lib/api/financial.api";
import type {
  BreakdownRow,
  CompensationModel,
  FinancialDashboard,
  FinancialSettings,
  LedgerPage,
  PaymentPage,
  PayrollDocument,
  PayrollList,
  PayrollSettlement,
  ProfessorFinancialDetail,
  ReportTable,
  RevenueSeries,
  StatusSlice,
  StudentPayment,
} from "@/types";

/**
 * Query keys, namespaced under `financial` so one mutation can invalidate the
 * whole domain without reaching for the nuclear `invalidateQueries()` the older
 * payment hooks used — that refetched every unrelated screen in the app.
 */
export const financialKeys = {
  all: ["financial"] as const,
  dashboard: (f: FinancialFilters) => ["financial", "dashboard", f] as const,
  revenue: (f: FinancialFilters) => ["financial", "revenue", f] as const,
  profit: (f: FinancialFilters) => ["financial", "profit", f] as const,
  collection: (f: FinancialFilters) => ["financial", "collection", f] as const,
  late: (f: FinancialFilters) => ["financial", "late", f] as const,
  status: (f: FinancialFilters) => ["financial", "status", f] as const,
  performance: (f: FinancialFilters) => ["financial", "performance", f] as const,
  breakdown: (d: string, f: FinancialFilters) => ["financial", "breakdown", d, f] as const,
  payments: (q: Record<string, unknown>) => ["financial", "payments", q] as const,
  payment: (id: string) => ["financial", "payment", id] as const,
  studentHistory: (id: string) => ["financial", "studentHistory", id] as const,
  payroll: (q: Record<string, unknown>) => ["financial", "payroll", q] as const,
  professor: (id: string, period?: string) => ["financial", "professor", id, period] as const,
  settlement: (id: string, period?: string) => ["financial", "settlement", id, period] as const,
  payoutDocuments: (id: string) => ["financial", "payoutDocuments", id] as const,
  professorDocuments: (id: string, period?: string) => ["financial", "professorDocuments", id, period] as const,
  ledger: (q: Record<string, unknown>) => ["financial", "ledger", q] as const,
  activity: (q: Record<string, unknown>) => ["financial", "activity", q] as const,
  report: (q: Record<string, unknown>) => ["financial", "report", q] as const,
  settings: () => ["financial", "settings"] as const,
};

/**
 * Anything that moves money invalidates the whole `financial` namespace.
 *
 * A single payment changes the dashboard, the analytics series, the payroll
 * balance and the ledger at once; trying to name the affected keys precisely
 * would be more code and one forgotten key away from showing a stale total.
 */
function useFinancialMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  options?: { onSuccess?: (result: TResult) => void },
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: financialKeys.all });
      options?.onSuccess?.(result);
    },
  });
}

/**
 * Payroll and payment screens stay live while open: money moves from other
 * places (front desk, another tab, the billing job) without ever firing a
 * mutation on this page, so the screens poll every few seconds instead of
 * waiting for a refetch that never comes.
 */
const REALTIME_INTERVAL = 30_000;
const realtime = { refetchInterval: REALTIME_INTERVAL as number | false };

// ---------------------------------------------------------------------------
// Dashboard & analytics
// ---------------------------------------------------------------------------

export function useFinancialDashboard(filters: FinancialFilters = {}) {
  return useQuery<FinancialDashboard>({
    queryKey: financialKeys.dashboard(filters),
    queryFn: () => financialApi.dashboard(filters),
    staleTime: 60_000,
  });
}

export function useRevenueSeries(filters: FinancialFilters = {}) {
  return useQuery<RevenueSeries>({
    queryKey: financialKeys.revenue(filters),
    queryFn: () => financialApi.revenueSeries(filters),
    staleTime: 60_000,
  });
}

export function useProfitSeries(filters: FinancialFilters = {}) {
  return useQuery({
    queryKey: financialKeys.profit(filters),
    queryFn: () => financialApi.profitSeries(filters),
    staleTime: 60_000,
  });
}

export function useCollectionTrend(filters: FinancialFilters = {}) {
  return useQuery({
    queryKey: financialKeys.collection(filters),
    queryFn: () => financialApi.collectionTrend(filters),
    staleTime: 60_000,
  });
}

export function useLatePaymentTrend(filters: FinancialFilters = {}) {
  return useQuery({
    queryKey: financialKeys.late(filters),
    queryFn: () => financialApi.latePayments(filters),
    staleTime: 60_000,
  });
}

export function useStatusDistribution(filters: FinancialFilters = {}) {
  return useQuery<StatusSlice[]>({
    queryKey: financialKeys.status(filters),
    queryFn: () => financialApi.statusDistribution(filters),
    staleTime: 60_000,
  });
}

export function useProfessorPerformance(filters: FinancialFilters = {}) {
  return useQuery({
    queryKey: financialKeys.performance(filters),
    queryFn: () => financialApi.professorPerformance(filters),
    staleTime: 60_000,
  });
}

/** `enabled` lets a tab render its charts only once it is actually shown. */
export function useBreakdown(dimension: string, filters: FinancialFilters = {}, enabled = true) {
  return useQuery<BreakdownRow[]>({
    queryKey: financialKeys.breakdown(dimension, filters),
    queryFn: () => financialApi.breakdown(dimension, filters),
    staleTime: 60_000,
    enabled,
  });
}

// ---------------------------------------------------------------------------
// Student payments
// ---------------------------------------------------------------------------

export function useFinancialPayments(query: Record<string, unknown> = {}) {
  return useQuery<PaymentPage>({
    queryKey: financialKeys.payments(query),
    queryFn: () => financialApi.payments(query),
    placeholderData: (previous) => previous,
    ...realtime,
  });
}

export function usePayment(id: string) {
  return useQuery<StudentPayment>({
    queryKey: financialKeys.payment(id),
    queryFn: () => financialApi.payment(id),
    enabled: !!id,
  });
}

export function useStudentPaymentHistory(studentId: string) {
  return useQuery<StudentPayment[]>({
    queryKey: financialKeys.studentHistory(studentId),
    queryFn: () => financialApi.studentHistory(studentId),
    enabled: !!studentId,
    ...realtime,
  });
}

export function useRecordTransaction() {
  return useFinancialMutation(
    ({ id, ...body }: { id: string; amount?: string; notes?: string; paid_at?: string }) =>
      financialApi.recordTransaction(id, body),
  );
}

export function useRefundPayment() {
  return useFinancialMutation(
    ({ id, ...body }: { id: string; amount: string; reason: string; notes?: string }) =>
      financialApi.refund(id, body),
  );
}

export function useCorrectPayment() {
  return useFinancialMutation(
    ({ id, ...body }: { id: string; amount: string; reason: string; notes?: string }) =>
      financialApi.correct(id, body),
  );
}

export function useCancelPayment() {
  return useFinancialMutation(({ id, reason }: { id: string; reason: string }) =>
    financialApi.cancelPayment(id, reason),
  );
}

export function useReopenPayment() {
  return useFinancialMutation(({ id }: { id: string }) => financialApi.reopenPayment(id));
}

export function useUpdatePaymentStatus() {
  return useFinancialMutation(({ id, ...body }: { id: string; status: string; reason?: string }) =>
    financialApi.updatePaymentStatus(id, body),
  );
}

export function useGenerateMonthlyInvoices() {
  return useFinancialMutation((months?: number) => financialApi.generateMonthly(months ?? 0));
}

/** Bills one student from enrolment through today plus `months` months ahead. */
export function useGenerateInvoiceForStudent() {
  return useFinancialMutation(({ studentId, months = 0 }: { studentId: string; months?: number }) =>
    financialApi.generateForStudent(studentId, months),
  );
}

export function useRefreshPaymentStatuses() {
  return useFinancialMutation((studentId?: string) => financialApi.refreshStatuses(studentId));
}

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

export function usePayroll(query: Record<string, unknown> = {}) {
  return useQuery<PayrollList>({
    queryKey: financialKeys.payroll(query),
    queryFn: () => financialApi.payroll(query),
    placeholderData: (previous) => previous,
    ...realtime,
  });
}

export function useProfessorFinancials(profId: string, period?: string) {
  return useQuery<ProfessorFinancialDetail>({
    queryKey: financialKeys.professor(profId, period),
    queryFn: () => financialApi.professorDetail(profId, period),
    enabled: !!profId,
    ...realtime,
  });
}

export function useRecordPayroll() {
  return useFinancialMutation(
    ({ profId, ...body }: { profId: string; amount: string; period?: string; notes?: string }) =>
      financialApi.recordPayroll(profId, body),
  );
}

export function useUpdatePayroll() {
  return useFinancialMutation(
    ({ payoutId, ...body }: { payoutId: string; amount?: string; notes?: string; reason?: string }) =>
      financialApi.updatePayroll(payoutId, body),
  );
}

export function useDeletePayroll() {
  return useFinancialMutation(({ payoutId, reason }: { payoutId: string; reason: string }) =>
    financialApi.deletePayroll(payoutId, reason),
  );
}

export function useUpsertCompensation() {
  return useFinancialMutation(
    ({
      profId,
      ...body
    }: {
      profId: string;
      model: CompensationModel;
      percentage?: string | null;
      fixed_amount?: string | null;
      custom_formula?: string | null;
      notes?: string;
    }) => financialApi.upsertCompensation(profId, body),
  );
}

export function useRemoveCompensation() {
  return useFinancialMutation(({ profId }: { profId: string }) =>
    financialApi.removeCompensation(profId),
  );
}

export function useSettlement(profId: string, period?: string, enabled = true) {
  return useQuery<PayrollSettlement>({
    queryKey: financialKeys.settlement(profId, period),
    queryFn: () => financialApi.settlement(profId, period),
    enabled: !!profId && enabled,
    ...realtime,
  });
}

export function usePayoutDocuments(payoutId: string, enabled = true) {
  return useQuery<PayrollDocument[]>({
    queryKey: financialKeys.payoutDocuments(payoutId),
    queryFn: () => financialApi.payoutDocuments(payoutId),
    enabled: !!payoutId && enabled,
    ...realtime,
  });
}

export function useProfessorDocuments(profId: string, period?: string, enabled = true) {
  return useQuery<PayrollDocument[]>({
    queryKey: financialKeys.professorDocuments(profId, period),
    queryFn: () => financialApi.professorDocuments(profId, period),
    enabled: !!profId && enabled,
    ...realtime,
  });
}

export function useRegenerateDocuments() {
  return useFinancialMutation((payoutId: string) => financialApi.regenerateDocuments(payoutId));
}

// ---------------------------------------------------------------------------
// Transactions, reports, settings
// ---------------------------------------------------------------------------

export function useLedger(query: Record<string, unknown> = {}, enabled = true) {
  return useQuery<LedgerPage>({
    queryKey: financialKeys.ledger(query),
    queryFn: () => financialApi.ledger(query),
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function useFinancialActivity(query: Record<string, unknown> = {}, enabled = true) {
  return useQuery({
    queryKey: financialKeys.activity(query),
    queryFn: () => financialApi.activity(query),
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function useReport(query: Record<string, unknown>, enabled = true) {
  return useQuery<ReportTable>({
    queryKey: financialKeys.report(query),
    queryFn: () => financialApi.report(query),
    enabled,
  });
}

export function useFinancialSettings() {
  return useQuery<FinancialSettings>({
    queryKey: financialKeys.settings(),
    queryFn: () => financialApi.settings(),
    staleTime: 300_000,
  });
}

export function useUpdateFinancialSettings() {
  return useFinancialMutation((body: Partial<FinancialSettings> & { custom_formula_check?: string }) =>
    financialApi.updateSettings(body),
  );
}

/** Replaces (or sets for the first time) the academy logo. */
export function useUploadLogo() {
  return useFinancialMutation((file: File) => financialApi.uploadLogo(file));
}

/** Removes the academy logo, falling back to the text-only branding. */
export function useRemoveLogo() {
  return useFinancialMutation(() => financialApi.removeLogo());
}
