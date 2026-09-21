import { getApiClient } from "@/lib/api/client";

export interface TableColumnIssue {
  column: string;
  type: string;
}

export interface TablePreview {
  table: string;
  label: string;
  columnsPresent: string[];
  missingRequired: TableColumnIssue[];
  missingOptional: TableColumnIssue[];
  extraColumns: string[];
  missingTargetTables: { column: string; targetLabel: string }[];
  rowCount: number;
  /** Hidden system rows (deleted-children placeholders) — never displayed, still imported. */
  systemRowCount: number;
  /** True when every row in the file is a system placeholder (nothing to display). */
  allSystem: boolean;
  sampleRows: Record<string, string>[];
}

export interface ImportPreview {
  fileName: string;
  sourceVersion: string | null;
  exportedAt: string | null;
  formatVersion: number;
  tables: TablePreview[];
  ignoredTables: string[];
  errors: string[];
}

export interface ImportResult {
  success: boolean;
  message: string;
  imported: Record<string, number>;
}

/** Missing columns to fill manually, keyed by table key then column name. */
export type FillValues = Record<string, Record<string, string>>;

export const dataTransferApi = {
  async exportAll(): Promise<void> {
    const response = await getApiClient().get("/system/data/export", {
      responseType: "blob",
    });
    const blob = response.data as Blob;
    const disposition = response.headers?.["content-disposition"] ?? "";
    const match = /filename="?([^";]+)"?/.exec(disposition);
    const filename = match?.[1] ?? `iq-academy-data-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  async previewImport(file: File, phrase?: string): Promise<ImportPreview> {
    const form = new FormData();
    form.append("file", file);
    if (phrase?.trim()) form.append("phrase", phrase.trim());
    const response = await getApiClient().post<{ data: ImportPreview }>(
      "/system/data/import/preview",
      form,
    );
    return response.data.data;
  },

  async importData(file: File, fills: FillValues, phrase?: string): Promise<ImportResult> {
    const form = new FormData();
    form.append("file", file);
    form.append("fills", JSON.stringify(fills));
    if (phrase?.trim()) form.append("phrase", phrase.trim());
    const response = await getApiClient().post<{ data: ImportResult }>(
      "/system/data/import",
      form,
    );
    return response.data.data;
  },
};