import { getApiClient } from "@/lib/api/client";

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportResult {
  imported: number;
  skippedDuplicates: number;
  failed: number;
  created: {
    fields: number;
    professors: number;
    levels: number;
    groups: number;
  };
  errors: ImportRowError[];
}

export interface ParsedRow {
  rowNumber: number;
  field: string;
  professor: string;
  professorPhone: string;
  level: string;
  group: string;
  firstName: string;
  lastName: string;
  phone: string;
  parentPhone: string | null;
  email: string | null;
  enrollmentDate: string;
  monthlyFee: number;
  status: string;
}

export interface PreviewResult {
  rows: ParsedRow[];
  errors: ImportRowError[];
  columnMap: Record<string, string>;
  missingColumns: string[];
}

export const importsApi = {
  async previewStudents(file: File): Promise<PreviewResult> {
    const form = new FormData();
    form.append("file", file);
    const response = await getApiClient().post<{ data: PreviewResult }>(
      "/imports/preview",
      form,
    );
    return response.data.data;
  },

  async confirmImport(rows: ParsedRow[]): Promise<ImportResult> {
    const response = await getApiClient().post<{ data: ImportResult }>(
      "/imports/preview/confirm",
      { rows },
    );
    return response.data.data;
  },

  async importStudents(file: File): Promise<ImportResult> {
    const form = new FormData();
    form.append("file", file);
    const response = await getApiClient().post<{ data: ImportResult }>(
      "/imports/students",
      form,
    );
    return response.data.data;
  },

  async downloadTemplate(): Promise<void> {
    const response = await getApiClient().get("/imports/students/template", {
      responseType: "blob",
    });
    const url = URL.createObjectURL(response.data as Blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "iq-academy-student-import-template.xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
