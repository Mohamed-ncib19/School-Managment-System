import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { and, eq, inArray, sql, SQL, SQLWrapper } from "drizzle-orm";
import * as ExcelJS from "exceljs";
import { DbService, Tx } from "../db/db.service";
import { fields, groups, levels, professors, studentAssignments, students } from "../db/schema";
import { AuditService } from "../audit/audit.service";
import { StudentStatus } from "@iq/shared";
import { normalizeTunisianPhone } from "../common/phone.util";
import {
  IMPORT_COLUMNS,
  ImportResult,
  ParsedRow,
  PreviewResult,
  RowError,
} from "./import.types";

/** Header text -> canonical key, so "first name"/"First Name"/"FIRST_NAME" all match. */
const normalizeHeader = (value: string) =>
  value.toString().trim().toLowerCase().replace(/[\s_-]+/g, "");

const HEADER_KEYS: Record<string, keyof ParsedRow> = {
  field: "field",
  professor: "professor",
  professorphone: "professorPhone",
  level: "level",
  group: "group",
  firstname: "firstName",
  lastname: "lastName",
  phone: "phone",
  parentphone: "parentPhone",
  email: "email",
  enrollmentdate: "enrollmentDate",
  monthlyfee: "monthlyFee",
  status: "status",
};

const STUDENT_STATUSES: StudentStatus[] = ["active", "paused", "withdrawn"];

/**
 * Canonical form for hierarchy and person names: lowercase, French diacritics
 * folded, inner whitespace collapsed. "  MATH " == "math", "Mélanie" ==
 * "melanie" — so re-importing a roster typed with different casing or accents
 * reuses the existing Level/Field/Professor/Group and skips the existing
 * student instead of forking duplicates.
 */
export const normName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[àâä]/g, "a")
    .replace(/ç/g, "c")
    .replace(/[éèêë]/g, "e")
    .replace(/[îï]/g, "i")
    .replace(/[ôö]/g, "o")
    .replace(/[ùûü]/g, "u")
    .replace(/ÿ/g, "y")
    .replace(/\s+/g, " ")
    .trim();

/** SQL mirror of normName for name columns (translate == the JS map above). */
const normCol = (col: SQLWrapper): SQL<unknown> =>
  sql`btrim(regexp_replace(translate(lower(${col}), 'àâäçéèêëîïôöùûüÿ', 'aaaceeeeiioouuuy'), '\s+', ' ', 'g'))`;

const asValidDate = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
};

export interface RowValidationProblem {
  index: number;
  message: string;
}

/**
 * Re-validates client-supplied rows for `POST /imports/preview/confirm`.
 * Preview rows round-trip through the browser as JSON (where Dates arrive as
 * strings and any field can be hand-edited), so the server must not trust
 * them: every row is checked and normalised, and tampered rows are rejected
 * before anything is written.
 */
export function validateImportedRows(rows: ParsedRow[]): {
  problems: RowValidationProblem[];
  clean: ParsedRow[];
} {
  const problems: RowValidationProblem[] = [];
  const clean: ParsedRow[] = [];

  rows.forEach((row, index) => {
    const missing = (
      ["level", "field", "professor", "group", "firstName", "lastName", "phone"] as const
    ).filter((key) => typeof row[key] !== "string" || !row[key].trim());
    if (missing.length > 0) {
      problems.push({ index, message: `missing required value(s): ${missing.join(", ")}` });
      return;
    }
    const fee = Number(row.monthlyFee);
    if (!Number.isFinite(fee) || fee < 0) {
      problems.push({ index, message: "monthlyFee must be a finite number >= 0" });
      return;
    }
    const enrollmentDate = asValidDate(row.enrollmentDate);
    if (!enrollmentDate) {
      problems.push({ index, message: "enrollmentDate must be a valid date" });
      return;
    }
    const status = String(row.status ?? "").toLowerCase().trim() as StudentStatus;
    if (!STUDENT_STATUSES.includes(status)) {
      problems.push({ index, message: `status must be one of: ${STUDENT_STATUSES.join(", ")}` });
      return;
    }
    clean.push({ ...row, monthlyFee: fee, enrollmentDate, status });
  });

  return { problems, clean };
}

/**
 * Rows per INSERT.
 *
 * PostgreSQL allows at most 65535 bind parameters per statement and a
 * multi-row insert spends one per column per row, so a large roster has to be
 * handed over in batches rather than as one statement.
 */
const IMPORT_CHUNK = 500;

/** Per-import lookup of rows already resolved, keyed by parent id + name. */
interface ImportCaches {
  levels: Map<string, string>;
  fields: Map<string, string>;
  professors: Map<string, string>;
  groups: Map<string, string>;
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  sanitize(value: string): string {
    return value.replace(/[<>&"']/g, "").trim();
  }

  async previewStudents(buffer: Buffer): Promise<PreviewResult> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch {
      throw new BadRequestException("Impossible de lire ce fichier — est-ce un classeur .xlsx valide ?");
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException("Ce classeur ne contient aucune feuille.");

    const columnMap: Record<string, string> = {};
    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
      const key = normalizeHeader(this.cellText(cell));
      if (HEADER_KEYS[key]) {
        columnMap[String(colNumber)] = HEADER_KEYS[key];
      }
    });

    const { map: rawColumnMap, missing } = this.mapColumns(sheet);
    const { rows, errors } = this.parseRows(sheet, rawColumnMap);

    return { rows, errors, columnMap, missingColumns: missing };
  }

  async importStudentsFromRows(rows: ParsedRow[], actorUserId: string): Promise<ImportResult> {
    const result: ImportResult = {
      imported: 0,
      skippedDuplicates: 0,
      failed: 0,
      created: { levels: 0, fields: 0, professors: 0, groups: 0 },
      errors: [],
    };

    if (rows.length === 0) return result;

    // Rows come back from the browser as JSON — re-validate, because Dates
    // arrive as strings and any field may have been hand-edited in between.
    const { problems, clean } = validateImportedRows(rows);
    for (const problem of problems) {
      result.failed++;
      result.errors.push({
        row: rows[problem.index]?.rowNumber ?? problem.index + 1,
        message: problem.message,
      });
    }
    if (clean.length === 0) return result;

    await this.db.client.transaction(async (tx) => {
      await this.insertRows(tx, clean, actorUserId, result);
    });

    await this.audit.createLog(actorUserId, "import.students", "students", actorUserId, {
      imported: result.imported,
      skippedDuplicates: result.skippedDuplicates,
      failed: result.failed,
      created: result.created,
    });

    this.logger.log(
      `Imported ${result.imported} students (${result.skippedDuplicates} duplicates skipped, ${result.failed} rows rejected)`,
    );

    return result;
  }

  /** Builds the blank workbook staff fill in, with one example row. */
  async buildTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "School Management System";
    const sheet = workbook.addWorksheet("Students");

    sheet.columns = IMPORT_COLUMNS.map((header) => ({
      header,
      key: header,
      width: Math.max(16, header.length + 4),
    }));

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF264EAE" },
    };
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    sheet.addRow([
      "Level 1",
      "Languages",
      "Ahmed Bensalem",
      "0555123456",
      "Group A",
      "Yasmine",
      "Haddad",
      "0661234567",
      "0770987654",
      "yasmine@example.com",
      new Date(),
      3000,
      "active",
    ]);

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async importStudents(buffer: Buffer, actorUserId: string): Promise<ImportResult> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch {
      throw new BadRequestException("Impossible de lire ce fichier — est-ce un classeur .xlsx valide ?");
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException("Ce classeur ne contient aucune feuille.");

    const { map: columnMap } = this.mapColumns(sheet);
    const { rows, errors } = this.parseRows(sheet, columnMap);

    const result: ImportResult = {
      imported: 0,
      skippedDuplicates: 0,
      failed: errors.length,
      created: { levels: 0, fields: 0, professors: 0, groups: 0 },
      errors,
    };

    if (rows.length === 0) return result;

    // One transaction for the whole import: a mid-file failure must not leave
    // a half-built hierarchy behind.
    await this.db.client.transaction(async (tx) => {
      await this.insertRows(tx, rows, actorUserId, result);
    });

    await this.audit.createLog(actorUserId, "import.students", "students", actorUserId, {
      imported: result.imported,
      skippedDuplicates: result.skippedDuplicates,
      failed: result.failed,
      created: result.created,
    });

    this.logger.log(
      `Imported ${result.imported} students (${result.skippedDuplicates} duplicates skipped, ${result.failed} rows rejected)`,
    );

    return result;
  }

  /**
   * Inserts every parsed row, in as few statements as the data allows.
   *
   * Row by row this was at least four sequential round trips each — resolve the
   * group, look for a duplicate, insert the student, insert the enrolment —
   * inside a single transaction holding its locks and one of the ten pool
   * connections for the whole file. A two thousand row roster was the better
   * part of ten thousand queries, and the rest of the application waited.
   *
   * The transaction still wraps everything: a half-imported roster is worse
   * than a rejected one, and per-row error attribution (which row was a
   * duplicate) is preserved because the duplicate check is resolved for all
   * rows at once rather than abandoned.
   */
  private async insertRows(
    tx: Tx,
    rows: ParsedRow[],
    actorUserId: string,
    result: ImportResult,
  ): Promise<void> {
    const caches = this.newCaches();

    // Groups are resolved first and in order: this is the one step that can
    // create hierarchy, and the caches make a repeated group free.
    const resolved: { row: ParsedRow; groupId: string }[] = [];
    for (const row of rows) {
      resolved.push({ row, groupId: await this.resolveGroup(tx, row, actorUserId, caches, result) });
    }
    if (resolved.length === 0) return;

    // Append semantics: re-importing the same roster must not duplicate
    // students. Asked once for every group in the file rather than once per row.
    const groupIds = [...new Set(resolved.map((r) => r.groupId))];
    const existing = await tx
      .select({ group_id: students.group_id, first_name: students.first_name, last_name: students.last_name })
      .from(students)
      .where(inArray(students.group_id, groupIds));

    const seen = new Set(
      existing.map((s) => `${s.group_id}::${normName(s.first_name)}::${normName(s.last_name)}`),
    );

    const toInsert: { row: ParsedRow; groupId: string }[] = [];
    for (const entry of resolved) {
      const key = `${entry.groupId}::${normName(entry.row.firstName)}::${normName(entry.row.lastName)}`;
      // Also guards against the same student appearing twice in one file.
      if (seen.has(key)) {
        result.skippedDuplicates++;
        continue;
      }
      seen.add(key);
      toInsert.push(entry);
    }
    if (toInsert.length === 0) return;

    for (let i = 0; i < toInsert.length; i += IMPORT_CHUNK) {
      const chunk = toInsert.slice(i, i + IMPORT_CHUNK);
      const created = await tx
        .insert(students)
        .values(
          chunk.map(({ row, groupId }) => ({
            group_id: groupId,
            first_name: this.sanitize(row.firstName),
            last_name: this.sanitize(row.lastName),
            phone: normalizeTunisianPhone(row.phone) ?? this.sanitize(row.phone),
            parent_phone: row.parentPhone
              ? (normalizeTunisianPhone(row.parentPhone) ?? this.sanitize(row.parentPhone))
              : null,
            email: row.email ? this.sanitize(row.email) : null,
            enrollment_date: row.enrollmentDate,
            monthly_fee: String(row.monthlyFee),
            status: row.status,
          })),
        )
        .returning({ id: students.id });

      // `returning` preserves insert order, so each new id lines up with the
      // row it came from and the enrolments go in as one statement too.
      await tx.insert(studentAssignments).values(
        created.map((student, index) => ({
          student_id: student.id,
          group_id: chunk[index].groupId,
          fee: String(chunk[index].row.monthlyFee),
        })),
      );

      result.imported += created.length;
    }
  }

  private newCaches(): ImportCaches {
    return { levels: new Map(), fields: new Map(), professors: new Map(), groups: new Map() };
  }

  /**
   * Walks a row's Level > Field > Professor > Group chain, creating whatever is
   * missing and reusing whatever is already there, and returns the group id.
   *
   * Levels are matched school-wide by name. Everything below is matched within
   * its own parent, so "Group A" under two different professors stays two
   * groups, and a teacher listed against two levels gets one row per level -
   * which is what a professor row means now that it sits inside a level.
   */
  private async resolveGroup(
    tx: Tx,
    row: ParsedRow,
    actorUserId: string,
    caches: ImportCaches,
    result: ImportResult,
  ): Promise<string> {
    // Normalised once: matching is case/accent/space-insensitive, while the
    // inserted display names below keep the row's original spelling.
    const level = normName(row.level);
    const field = normName(row.field);
    const professor = normName(row.professor);
    const group = normName(row.group);

    let levelId = caches.levels.get(level);
    if (!levelId) {
      const [existing] = await tx
        .select({ id: levels.id })
        .from(levels)
        .where(eq(normCol(levels.name), level))
        .limit(1);
      if (existing) {
        levelId = existing.id;
      } else {
        const [created] = await tx.insert(levels).values({ name: this.sanitize(row.level) }).returning({ id: levels.id });
        levelId = created.id;
        result.created.levels++;
      }
      caches.levels.set(level, levelId);
    }

    const fieldKey = `${levelId}::${field}`;
    let fieldId = caches.fields.get(fieldKey);
    if (!fieldId) {
      const [existing] = await tx
        .select({ id: fields.id })
        .from(fields)
        .where(and(eq(fields.level_id, levelId), eq(normCol(fields.name), field)))
        .limit(1);
      if (existing) {
        fieldId = existing.id;
      } else {
        const [created] = await tx
          .insert(fields)
          .values({ level_id: levelId, name: this.sanitize(row.field), created_by: actorUserId })
          .returning({ id: fields.id });
        fieldId = created.id;
        result.created.fields++;
      }
      caches.fields.set(fieldKey, fieldId);
    }

    const profKey = `${fieldId}::${professor}`;
    let profId = caches.professors.get(profKey);
    if (!profId) {
      const [existing] = await tx
        .select({ id: professors.id })
        .from(professors)
        .where(and(eq(professors.field_id, fieldId), eq(normCol(professors.full_name), professor)))
        .limit(1);
      if (existing) {
        profId = existing.id;
      } else {
        const [created] = await tx
          .insert(professors)
          .values({
            field_id: fieldId,
            full_name: this.sanitize(row.professor),
            phone:
              row.professorPhone && row.professorPhone !== "â"
                ? (normalizeTunisianPhone(row.professorPhone) ?? this.sanitize(row.professorPhone))
                : "",
          })
          .returning({ id: professors.id });
        profId = created.id;
        result.created.professors++;
      }
      caches.professors.set(profKey, profId);
    }

    const groupKey = `${profId}::${group}`;
    let groupId = caches.groups.get(groupKey);
    if (!groupId) {
      const [existing] = await tx
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.prof_id, profId), eq(normCol(groups.name), group)))
        .limit(1);
      if (existing) {
        groupId = existing.id;
      } else {
        const [created] = await tx
          .insert(groups)
          .values({ prof_id: profId, name: this.sanitize(row.group) })
          .returning({ id: groups.id });
        groupId = created.id;
        result.created.groups++;
      }
      caches.groups.set(groupKey, groupId);
    }

    return groupId;
  }

  private mapColumns(sheet: ExcelJS.Worksheet): { map: Map<keyof ParsedRow, number>; missing: string[] } {
    const headerRow = sheet.getRow(1);
    const map = new Map<keyof ParsedRow, number>();

    headerRow.eachCell((cell, colNumber) => {
      const key = HEADER_KEYS[normalizeHeader(this.cellText(cell))];
      if (key) map.set(key, colNumber);
    });

    const required: (keyof ParsedRow)[] = [
      "level",
      "field",
      "professor",
      "group",
      "firstName",
      "lastName",
      "phone",
      "enrollmentDate",
      "monthlyFee",
    ];
    const missing = required.filter((key) => !map.has(key));
    return { map, missing };
  }

  private parseRows(
    sheet: ExcelJS.Worksheet,
    columns: Map<keyof ParsedRow, number>,
  ): { rows: ParsedRow[]; errors: RowError[] } {
    const rows: ParsedRow[] = [];
    const errors: RowError[] = [];

    const read = (row: ExcelJS.Row, key: keyof ParsedRow): string => {
      const col = columns.get(key);
      if (!col) return "";
      return this.cellText(row.getCell(col));
    };

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);

      const values = {
        level: read(row, "level"),
        field: read(row, "field"),
        professor: read(row, "professor"),
        professorPhone: read(row, "professorPhone"),
        group: read(row, "group"),
        firstName: read(row, "firstName"),
        lastName: read(row, "lastName"),
        phone: read(row, "phone"),
        parentPhone: read(row, "parentPhone"),
        email: read(row, "email"),
        enrollmentDate: read(row, "enrollmentDate"),
        monthlyFee: read(row, "monthlyFee"),
        status: read(row, "status"),
      };

      // Skip blank spacer rows rather than reporting them as failures.
      if (Object.values(values).every((v) => v === "")) continue;

      const missing = (
        [
          ["level", "Level"],
          ["field", "Field"],
          ["professor", "Professor"],
          ["group", "Group"],
          ["firstName", "First Name"],
          ["lastName", "Last Name"],
          ["phone", "Phone"],
        ] as const
      )
        .filter(([key]) => !values[key])
        .map(([, label]) => label);

      if (missing.length > 0) {
        errors.push({ row: rowNumber, message: `Missing required value(s): ${missing.join(", ")}` });
        continue;
      }

      const enrollmentDate = this.parseDate(
        columns.get("enrollmentDate") ? row.getCell(columns.get("enrollmentDate")!) : undefined,
      );
      if (!enrollmentDate) {
        errors.push({
          row: rowNumber,
          message: `Enrollment Date "${values.enrollmentDate}" is not a valid date`,
        });
        continue;
      }

      // Strip currency symbols/spaces, but insist on an actual number afterwards.
      // Without the digit check, "abc" cleans to "" and Number("") is 0 â which
      // would silently enrol a student at a zero monthly fee.
      const feeCleaned = values.monthlyFee
        .replace(/\s/g, "")
        .replace(/,/g, ".")
        .replace(/[^\d.]/g, "");
      if (!/^\d+(\.\d+)?$/.test(feeCleaned)) {
        errors.push({
          row: rowNumber,
          message: `Monthly Fee "${values.monthlyFee}" is not a valid amount`,
        });
        continue;
      }
      const monthlyFee = Number(feeCleaned);

      const statusRaw = values.status.toLowerCase().trim();
      const status = (statusRaw || "active") as StudentStatus;
      if (!STUDENT_STATUSES.includes(status)) {
        errors.push({
          row: rowNumber,
          message: `Status "${values.status}" must be one of: ${STUDENT_STATUSES.join(", ")}`,
        });
        continue;
      }

      const phone = normalizeTunisianPhone(values.phone);
      if (!phone) {
        errors.push({
          row: rowNumber,
          message: `Phone "${values.phone}" must be 8 digits with the +216 country code, e.g. +216 22 123 456`,
        });
        continue;
      }

      const parentPhone = values.parentPhone ? normalizeTunisianPhone(values.parentPhone) : null;
      if (values.parentPhone && !parentPhone) {
        errors.push({
          row: rowNumber,
          message: `Parent Phone "${values.parentPhone}" must be 8 digits with the +216 country code, e.g. +216 22 123 456`,
        });
        continue;
      }

      rows.push({
        rowNumber,
        level: values.level,
        field: values.field,
        professor: values.professor,
        professorPhone: values.professorPhone || "â",
        group: values.group,
        firstName: values.firstName,
        lastName: values.lastName,
        phone,
        parentPhone,
        email: values.email || null,
        enrollmentDate,
        monthlyFee,
        status,
      });
    }

    return { rows, errors };
  }

  private cellText(cell: ExcelJS.Cell | undefined): string {
    if (!cell) return "";
    const value = cell.value;
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object") {
      // Formula / rich-text / hyperlink cells
      if ("result" in value && value.result !== undefined) return String(value.result).trim();
      if ("text" in value && value.text !== undefined) return String(value.text).trim();
      if ("richText" in value && Array.isArray((value as any).richText)) {
        return (value as any).richText.map((part: any) => part.text).join("").trim();
      }
      return "";
    }
    return String(value).trim();
  }

  /**
   * enrollment_date is a calendar day, not an instant â it anchors the monthly
   * billing anniversary (Â§3). Pinning it to UTC midnight keeps the day-of-month
   * stable regardless of the server's timezone; without this a date can drift
   * to the previous day and shift a student's whole billing schedule.
   */
  private toUtcMidnight(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private parseDate(cell: ExcelJS.Cell | undefined): Date | null {
    if (!cell) return null;
    const value = cell.value;
    if (value instanceof Date) return this.toUtcMidnight(value);

    const text = this.cellText(cell);
    if (!text) return null;

    // Excel serial number (days since 1899-12-30)
    if (/^\d+(\.\d+)?$/.test(text)) {
      const serial = Number(text);
      if (serial > 0 && serial < 100000) {
        return this.toUtcMidnight(new Date(Date.UTC(1899, 11, 30) + serial * 86400000));
      }
    }

    // Prefer unambiguous DD/MM/YYYY over JS's US-centric default.
    const dmy = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (dmy) {
      const [, d, m, y] = dmy;
      const date = new Date(Date.UTC(+y, +m - 1, +d));
      return isNaN(date.getTime()) ? null : this.toUtcMidnight(date);
    }

    const parsed = new Date(text);
    return isNaN(parsed.getTime()) ? null : this.toUtcMidnight(parsed);
  }
}
