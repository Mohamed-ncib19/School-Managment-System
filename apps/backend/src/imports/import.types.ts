import { StudentStatus } from "@iq/shared";

/** Column headers of the flat student import sheet, in display order. */
export const IMPORT_COLUMNS = [
  "Level",
  "Field",
  "Professor",
  "Professor Phone",
  "Group",
  "First Name",
  "Last Name",
  "Phone",
  "Parent Phone",
  "Email",
  "Enrollment Date",
  "Monthly Fee",
  "Status",
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export interface ParsedRow {
  rowNumber: number;
  level: string;
  field: string;
  professor: string;
  professorPhone: string;
  group: string;
  firstName: string;
  lastName: string;
  phone: string;
  parentPhone: string | null;
  email: string | null;
  enrollmentDate: Date;
  monthlyFee: number;
  status: StudentStatus;
}

export interface RowError {
  row: number;
  message: string;
}

export interface ImportResult {
  imported: number;
  skippedDuplicates: number;
  failed: number;
  created: {
    levels: number;
    fields: number;
    professors: number;
    groups: number;
  };
  errors: RowError[];
}

export interface PreviewResult {
  rows: ParsedRow[];
  errors: RowError[];
  columnMap: Record<string, string>;
  missingColumns: string[];
}
