import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as ExcelJS from "exceljs";
import { PrismaService } from "../prisma/prisma.service";
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
    private readonly prisma: PrismaService,
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
      throw new BadRequestException("Could not read that file â€” is it a valid .xlsx workbook?");
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException("The workbook has no sheets.");

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

    await this.prisma.$transaction(async (tx) => {
      const caches = this.newCaches();

      for (const row of rows) {
        const groupId = await this.resolveGroup(tx, row, actorUserId, caches, result);

        const duplicate = await tx.students.findFirst({
          where: {
            group_id: groupId,
            first_name: row.firstName,
            last_name: row.lastName,
          },
        });
        if (duplicate) {
          result.skippedDuplicates++;
          continue;
        }

        await tx.students.create({
          data: {
            group_id: groupId,
            first_name: this.sanitize(row.firstName),
            last_name: this.sanitize(row.lastName),
            phone: normalizeTunisianPhone(row.phone) ?? this.sanitize(row.phone),
            parent_phone: row.parentPhone ? (normalizeTunisianPhone(row.parentPhone) ?? this.sanitize(row.parentPhone)) : null,
            email: row.email ? this.sanitize(row.email) : null,
            enrollment_date: row.enrollmentDate,
            monthly_fee: row.monthlyFee,
            status: row.status,
            assignments: {
              create: [{ group_id: groupId, fee: row.monthlyFee }],
            },
          },
        });
        result.imported++;
      }
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
      throw new BadRequestException("Could not read that file â€” is it a valid .xlsx workbook?");
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException("The workbook has no sheets.");

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
    await this.prisma.$transaction(async (tx) => {
      const caches = this.newCaches();

      for (const row of rows) {
        const groupId = await this.resolveGroup(tx, row, actorUserId, caches, result);

        // Append semantics: re-importing the same roster must not duplicate students.
        const duplicate = await tx.students.findFirst({
          where: {
            group_id: groupId,
            first_name: row.firstName,
            last_name: row.lastName,
          },
        });
        if (duplicate) {
          result.skippedDuplicates++;
          continue;
        }

        await tx.students.create({
          data: {
            group_id: groupId,
            first_name: this.sanitize(row.firstName),
            last_name: this.sanitize(row.lastName),
            phone: normalizeTunisianPhone(row.phone) ?? this.sanitize(row.phone),
            parent_phone: row.parentPhone ? (normalizeTunisianPhone(row.parentPhone) ?? this.sanitize(row.parentPhone)) : null,
            email: row.email ? this.sanitize(row.email) : null,
            enrollment_date: row.enrollmentDate,
            monthly_fee: row.monthlyFee,
            status: row.status,
            assignments: {
              create: [{ group_id: groupId, fee: row.monthlyFee }],
            },
          },
        });
        result.imported++;
      }
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
    tx: Prisma.TransactionClient,
    row: ParsedRow,
    actorUserId: string,
    caches: ImportCaches,
    result: ImportResult,
  ): Promise<string> {
    const levelKey = row.level.toLowerCase();
    let levelId = caches.levels.get(levelKey);
    if (!levelId) {
      const existing = await tx.levels.findFirst({ where: { name: row.level } });
      if (existing) {
        levelId = existing.id;
      } else {
        const created = await tx.levels.create({ data: { name: this.sanitize(row.level) } });
        levelId = created.id;
        result.created.levels++;
      }
      caches.levels.set(levelKey, levelId);
    }

    const fieldKey = `${levelId}::${row.field.toLowerCase()}`;
    let fieldId = caches.fields.get(fieldKey);
    if (!fieldId) {
      const existing = await tx.fields.findFirst({
        where: { level_id: levelId, name: row.field },
      });
      if (existing) {
        fieldId = existing.id;
      } else {
        const created = await tx.fields.create({
          data: { level_id: levelId, name: this.sanitize(row.field), created_by: actorUserId },
        });
        fieldId = created.id;
        result.created.fields++;
      }
      caches.fields.set(fieldKey, fieldId);
    }

    const profKey = `${fieldId}::${row.professor.toLowerCase()}`;
    let profId = caches.professors.get(profKey);
    if (!profId) {
      const existing = await tx.professors.findFirst({
        where: { field_id: fieldId, full_name: row.professor },
      });
      if (existing) {
        profId = existing.id;
      } else {
        const created = await tx.professors.create({
          data: {
            field_id: fieldId,
            full_name: this.sanitize(row.professor),
            phone:
              row.professorPhone && row.professorPhone !== "â€”"
                ? (normalizeTunisianPhone(row.professorPhone) ?? this.sanitize(row.professorPhone))
                : "",
          },
        });
        profId = created.id;
        result.created.professors++;
      }
      caches.professors.set(profKey, profId);
    }

    const groupKey = `${profId}::${row.group.toLowerCase()}`;
    let groupId = caches.groups.get(groupKey);
    if (!groupId) {
      const existing = await tx.groups.findFirst({
        where: { prof_id: profId, name: row.group },
      });
      if (existing) {
        groupId = existing.id;
      } else {
        const created = await tx.groups.create({
          data: { prof_id: profId, name: this.sanitize(row.group) },
        });
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
      // Without the digit check, "abc" cleans to "" and Number("") is 0 â€” which
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
        professorPhone: values.professorPhone || "â€”",
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
   * enrollment_date is a calendar day, not an instant â€” it anchors the monthly
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
