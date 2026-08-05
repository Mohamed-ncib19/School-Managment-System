import { ApiClient, getApiClient, apiBaseUrl } from "./client";
import type {
  AttendanceGeneration,
  AttendanceSession,
  AttendanceSheet,
} from "@/types";

/**
 * Opens the print-ready A4 register in a new tab.
 *
 * The endpoint is JWT-protected, so the HTML is fetched through the
 * authenticated client as text and handed to a fresh tab — the same pattern
 * the payroll settlement documents use. The printed page carries its own
 * "Print / Save as PDF" button, so the PDF is produced by the browser's print
 * dialogue exactly as laid out.
 */
export async function openAttendancePrint(sheetId: string): Promise<void> {
  const html = await ApiClient.get<string>(`/attendance-sheets/${sheetId}/print`, {
    responseType: "text",
  });

  const tab = window.open("", "_blank");
  if (!tab) throw new Error("popup-blocked");

  tab.document.open();
  tab.document.write(html);
  tab.document.close();
}

/** Downloads the same register as an Excel workbook, named by the server. */
export async function downloadAttendanceExcel(sheetId: string): Promise<void> {
  const response = await getApiClient().get(`/attendance-sheets/${sheetId}/export`, {
    responseType: "blob",
  });

  const disposition = String(response.headers["content-disposition"] ?? "");
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/);
  const filename = decodeURIComponent(match?.[1] ?? "feuille-de-presence.xlsx");

  const url = URL.createObjectURL(response.data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const attendanceSheetsApi = {
  /** The raw print HTML (for a preview inside the app). */
  printHtml: (id: string) =>
    ApiClient.get<string>(`/attendance-sheets/${id}/print`, { responseType: "text" }),
  /** Absolute URL of the print page, when the app is served with credentials. */
  printUrl: (id: string) => `${apiBaseUrl()}/attendance-sheets/${id}/print`,
  listForGroup: (groupId: string) =>
    ApiClient.get<AttendanceSheet[]>("/attendance-sheets", { params: { groupId } }),
  get: (id: string) => ApiClient.get<AttendanceSheet>(`/attendance-sheets/${id}`),
  /** Lays out the sessions for a month without persisting anything. */
  generate: (data: { group_id: string; month: number; year: number; sessions_count?: number }) =>
    ApiClient.post<AttendanceGeneration>("/attendance-sheets/generate", data),
  save: (data: {
    group_id: string;
    month: number;
    year: number;
    schedule?: string;
    teacher_id?: string;
    teacher_name: string;
    level_name: string;
    field_name?: string;
    group_name: string;
    academic_year?: string;
    sessions?: AttendanceSession[];
    students: unknown[];
  }) => ApiClient.post<AttendanceSheet>("/attendance-sheets", data),
  remove: (id: string) => ApiClient.del(`/attendance-sheets/${id}`),
};
