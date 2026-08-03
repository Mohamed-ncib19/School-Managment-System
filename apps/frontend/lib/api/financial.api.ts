import { ApiClient, getApiClient } from "./client";
import type {
  CompensationModel,
  FinancialDashboard,
  FinancialSettings,
  Granularity,
  LedgerPage,
  PaymentPage,
  PayrollDocument,
  PayrollList,
  PayrollRow,
  PayrollSettlement,
  ProfessorFinancialDetail,
  ReportTable,
  RevenueSeries,
  StatusSlice,
  StudentPayment,
  TransactionType,
} from "@/types";

/**
 * The filter every financial screen speaks.
 *
 * One shape across the dashboard, analytics and reports, matching the backend's
 * `FinancialQueryDto` — a report opened from a filtered dashboard is scoped
 * identically, rather than each screen inventing its own parameters.
 */
export interface FinancialFilters {
  granularity?: Granularity;
  range?: "today" | "this_week" | "this_month" | "last_month" | "this_year" | "academic_year";
  from?: string;
  to?: string;
  levelId?: string;
  fieldId?: string;
  profId?: string;
  groupId?: string;
  studentId?: string;
  period?: string;
  dimension?: string;
  limit?: number;
  [key: string]: unknown;
}

/** Drops empty values so a blank select never becomes `?fieldId=`. */
function params(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = String(value);
  }
  return out;
}

const BASE = "/financial";

export const financialApi = {
  // Dashboard ---------------------------------------------------------------
  dashboard: (filters: FinancialFilters = {}) =>
    ApiClient.get<FinancialDashboard>(`${BASE}/dashboard`, { params: params(filters) }),

  summary: () => ApiClient.get<Record<string, unknown>>(`${BASE}/summary`),

  // Analytics ---------------------------------------------------------------
  revenueSeries: (filters: FinancialFilters = {}) =>
    ApiClient.get<RevenueSeries>(`${BASE}/analytics/revenue`, { params: params(filters) }),

  profitSeries: (filters: FinancialFilters = {}) =>
    ApiClient.get<{ granularity: Granularity; points: any[] }>(`${BASE}/analytics/profit`, {
      params: params(filters),
    }),

  collectionTrend: (filters: FinancialFilters = {}) =>
    ApiClient.get<{ granularity: Granularity; points: any[] }>(`${BASE}/analytics/collection-trend`, {
      params: params(filters),
    }),

  latePayments: (filters: FinancialFilters = {}) =>
    ApiClient.get<{ granularity: Granularity; points: any[] }>(`${BASE}/analytics/late-payments`, {
      params: params(filters),
    }),

  statusDistribution: (filters: FinancialFilters = {}) =>
    ApiClient.get<StatusSlice[]>(`${BASE}/analytics/status-distribution`, { params: params(filters) }),

  professorPerformance: (filters: FinancialFilters = {}) =>
    ApiClient.get<any[]>(`${BASE}/analytics/professor-performance`, { params: params(filters) }),

  breakdown: (dimension: string, filters: FinancialFilters = {}) =>
    ApiClient.get<any[]>(`${BASE}/analytics/breakdown/${dimension}`, { params: params(filters) }),

  // Student payments --------------------------------------------------------
  payments: (query: Record<string, unknown> = {}) =>
    ApiClient.getPaginated<StudentPayment, PaymentPage["meta"]>(`${BASE}/payments`, {
      params: params(query),
    }),

  payment: (id: string) => ApiClient.get<StudentPayment>(`${BASE}/payments/${id}`),

  studentHistory: (studentId: string) =>
    ApiClient.get<StudentPayment[]>(`${BASE}/payments/student/${studentId}`),

  recordTransaction: (id: string, body: { amount?: string; notes?: string; paid_at?: string }) =>
    ApiClient.post<StudentPayment>(`${BASE}/payments/${id}/transactions`, body),

  refund: (id: string, body: { amount: string; reason: string; notes?: string }) =>
    ApiClient.post<StudentPayment>(`${BASE}/payments/${id}/refund`, body),

  correct: (id: string, body: { amount: string; reason: string; notes?: string }) =>
    ApiClient.post<StudentPayment>(`${BASE}/payments/${id}/correct`, body),

  cancelPayment: (id: string, reason: string) =>
    ApiClient.patch<StudentPayment>(`${BASE}/payments/${id}/cancel`, { reason }),

  reopenPayment: (id: string) => ApiClient.patch<StudentPayment>(`${BASE}/payments/${id}/reopen`),

  updatePaymentStatus: (id: string, body: { status: string; reason?: string }) =>
    ApiClient.patch<StudentPayment>(`${BASE}/payments/${id}/status`, body),

  generateMonthly: (months = 0) =>
    ApiClient.post(`${BASE}/payments/generate`, undefined, { params: { months } }),

  generateForStudent: (studentId: string, months = 0) =>
    ApiClient.post(`${BASE}/payments/generate/${studentId}`, undefined, { params: { months } }),

  refreshStatuses: (studentId?: string) =>
    ApiClient.post(`${BASE}/payments/refresh-statuses`, undefined, {
      params: params({ studentId }),
    }),

  // Payroll -----------------------------------------------------------------
  payroll: (query: Record<string, unknown> = {}) =>
    ApiClient.getPaginated<PayrollRow, PayrollList["meta"]>(`${BASE}/payroll`, {
      params: params(query),
    }),

  professorDetail: (profId: string, period?: string) =>
    ApiClient.get<ProfessorFinancialDetail>(`${BASE}/payroll/professor/${profId}`, {
      params: params({ period }),
    }),

  recordPayroll: (
    profId: string,
    body: { amount: string; period?: string; notes?: string; paid_at?: string },
  ) => ApiClient.post(`${BASE}/payroll/professor/${profId}/pay`, body),

  updatePayroll: (payoutId: string, body: { amount?: string; notes?: string; reason?: string }) =>
    ApiClient.patch(`${BASE}/payroll/payment/${payoutId}`, body),

  deletePayroll: (payoutId: string, reason: string) =>
    ApiClient.del(`${BASE}/payroll/payment/${payoutId}`, { params: params({ reason }) }),

  upsertCompensation: (
    profId: string,
    body: {
      model: CompensationModel;
      percentage?: string | null;
      fixed_amount?: string | null;
      custom_formula?: string | null;
      notes?: string;
    },
  ) => ApiClient.put(`${BASE}/payroll/professor/${profId}/compensation`, body),

  removeCompensation: (profId: string) =>
    ApiClient.del(`${BASE}/payroll/professor/${profId}/compensation`),

  // Payroll settlement documents -------------------------------------------
  /** The settlement snapshot the printed documents are rendered from. */
  settlement: (profId: string, period?: string) =>
    ApiClient.get<PayrollSettlement>(`${BASE}/payroll/professor/${profId}/settlement`, {
      params: params({ period }),
    }),

  payoutDocuments: (payoutId: string) =>
    ApiClient.get<PayrollDocument[]>(`${BASE}/payroll/payment/${payoutId}/documents`),

  professorDocuments: (profId: string, period?: string) =>
    ApiClient.get<PayrollDocument[]>(`${BASE}/payroll/professor/${profId}/documents`, {
      params: params({ period }),
    }),

  regenerateDocuments: (payoutId: string) =>
    ApiClient.post<{ generated: string[] }>(`${BASE}/payroll/payment/${payoutId}/documents/regenerate`),

  // Transactions ------------------------------------------------------------
  ledger: (query: Record<string, unknown> = {}) =>
    ApiClient.getPaginated<LedgerPage["data"][number], LedgerPage["meta"]>(`${BASE}/transactions`, {
      params: params(query),
    }),

  activity: (query: Record<string, unknown> = {}) =>
    ApiClient.getPaginated<any>(`${BASE}/transactions/activity`, {
      params: params(query),
    }),

  activityActions: () => ApiClient.get<string[]>(`${BASE}/transactions/activity/actions`),

  // Reports -----------------------------------------------------------------
  report: (query: Record<string, unknown> = {}) =>
    ApiClient.get<ReportTable>(`${BASE}/reports`, { params: params(query) }),

  // Settings ----------------------------------------------------------------
  settings: () => ApiClient.get<FinancialSettings>(`${BASE}/settings`),

  updateSettings: (body: Partial<FinancialSettings> & { custom_formula_check?: string }) =>
    ApiClient.patch<FinancialSettings>(`${BASE}/settings`, body),

  /** Uploads the academy logo (multipart field `file`). */
  uploadLogo: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return ApiClient.post<FinancialSettings>(`${BASE}/settings/logo`, form);
  },

  removeLogo: () => ApiClient.del(`${BASE}/settings/logo`),

  validateFormula: (formula: string) =>
    ApiClient.post<{ valid: boolean; error?: string }>(`${BASE}/settings/validate-formula`, { formula }),

  previewReceiptFormat: (format: string) =>
    ApiClient.post<{ sample: string }>(`${BASE}/settings/preview-receipt-format`, { format }),

  previewSplit: (body: {
    amount?: string;
    model?: CompensationModel;
    percentage?: string;
    fixed_amount?: string;
    custom_formula?: string;
    student_count?: number;
    group_count?: number;
  }) =>
    ApiClient.post<{
      amount: string;
      professor_share: string;
      school_share: string;
      fixed_component: string;
    }>(`${BASE}/settings/preview-split`, body),
};

/**
 * Documents — receipts and report exports.
 *
 * These endpoints sit behind the JWT guard, and a tab opened with `window.open`
 * carries no Authorization header. Passing the token in the query string would
 * fix that at the cost of writing a live credential into browser history, the
 * server's access log and any proxy in between — so instead the document is
 * fetched through the authenticated client and handed to the browser as a blob.
 * The user sees the same print dialogue or download either way.
 */

/** Fetches a receipt and opens it in a new tab with its own print dialogue. */
export async function openReceipt(kind: "payment" | "payroll", id: string): Promise<void> {
  const path =
    kind === "payroll"
      ? `${BASE}/payroll/payment/${id}/receipt`
      : `${BASE}/payments/${id}/receipt`;

  // The tab is opened inside the click gesture itself, before any await, so the
  // popup blocker still sees a trusting gesture — on stricter browsers an
  // `await` in between can cost the transient activation and the receipt never
  // opens. The document streams in once the fetch resolves.
  const tab = window.open("", "_blank");
  if (!tab) throw new Error("popup-blocked");
  tab.document.write(
    "<!DOCTYPE html><html><body style='font-family:sans-serif;color:#666;padding:40px'>Chargement…</body></html>",
  );

  const html = await ApiClient.get<string>(path, { responseType: "text" });

  // The server's quittance shell has no print trigger of its own — without this
  // the tab would open with the receipt but never raise the print dialogue, so
  // a click on "Print receipt" would look dead.
  const printTrigger =
    "<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},120)})</script>";
  const printable = html.includes("</body>")
    ? html.replace("</body>", `${printTrigger}</body>`)
    : html + printTrigger;

  tab.document.open();
  tab.document.write(printable);
  tab.document.close();
}

/**
 * Opens one stored settlement document (professor receipt or school report) in
 * a new tab. The page carries its own "Print / Save as PDF" button, so the PDF
 * is produced by the browser's print dialogue exactly as laid out — the same
 * convention as the quittances and report exports.
 */
export async function openPayrollDocument(docId: string): Promise<void> {
  const html = await ApiClient.get<string>(`${BASE}/payroll/document/${docId}`, {
    responseType: "text",
  });

  const tab = window.open("", "_blank");
  if (!tab) throw new Error("popup-blocked");

  tab.document.open();
  tab.document.write(html);
  tab.document.close();
}

/** Fetches a report export and saves it under the filename the server chose. */
export async function downloadReport(query: Record<string, unknown>): Promise<void> {
  // The raw axios instance, not an `ApiClient` helper: those peel the response
  // envelope and drop the headers, and the filename lives in one of them.
  const response = await getApiClient().get(`${BASE}/reports/export`, {
    params: params(query),
    responseType: "blob",
  });

  const disposition = String(response.headers["content-disposition"] ?? "");
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match?.[1] ?? `report.${query.format === "excel" ? "xlsx" : String(query.format ?? "csv")}`;

  const url = URL.createObjectURL(response.data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Released on the next tick so the download has taken its reference.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The "PDF" export opened in a new tab with its own print dialogue — the same
 * convention as the receipts. The server returns a print-ready A4 document;
 * the browser's "Save as PDF" produces the file, so a download pipe can never
 * hide a layout that the print dialogue shows.
 */
export async function openReportDocument(query: Record<string, unknown>): Promise<void> {
  // The tab is opened inside the click gesture itself, before any await, so the
  // popup blocker still sees a trusting gesture.
  const tab = window.open("", "_blank");
  if (!tab) throw new Error("popup-blocked");
  tab.document.write(
    "<!DOCTYPE html><html><body style='font-family:sans-serif;color:#666;padding:40px'>Chargement…</body></html>",
  );

  const html = await ApiClient.get<string>(`${BASE}/reports/export`, {
    params: params({ ...query, format: "pdf" }),
    responseType: "text",
  });

  // The server shell already raises the print dialogue on load; if it ever
  // stops, raise it here after a beat so the tab can finish painting first.
  const printTrigger =
    "<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},120)})</script>";
  const printable = html.includes("window.print")
    ? html
    : html.replace("</body>", `${printTrigger}</body>`);

  tab.document.open();
  tab.document.write(printable);
  tab.document.close();
}
