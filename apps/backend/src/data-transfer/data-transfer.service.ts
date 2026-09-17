import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { eq, getTableColumns } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { DbService } from "../db/db.service";
import { AuditService } from "../audit/audit.service";
import { deriveKey } from "../cloud-backup/crypto/kdf";
import { decodeObject } from "../cloud-backup/crypto/object-codec";
import { splitObject } from "../cloud-backup/crypto/object-header";
import {
  attendanceSheets,
  classrooms,
  fields,
  financialSettings,
  groups,
  hierarchyConfigurations,
  levels,
  payrollDocuments,
  payrollPayments,
  paymentTransactions,
  professorCompensations,
  professors,
  receiptCounters,
  scheduleEntries,
  scheduleEntryExceptions,
  studentAssignments,
  studentPayments,
  students,
  studentScheduleExceptions,
  systemSettings,
  timeSlots,
  users,
  whiteboards,
  workingHours,
} from "../db/schema";

/**
 * Version-tolerant full-data transfer.
 *
 * The export is a single JSON document: every table as a column-name header
 * plus rows, wrapped with a format marker and the exporting version. Because
 * columns travel with their names, an export made by any version can be
 * imported into any other — the current schema is the reference, and columns
 * the file does not carry are reported in the preview so they can be filled
 * manually (one value per column, applied to every row of that table).
 *
 * Import semantics are "replace the tables present in the file": their rows
 * are deleted and the file's rows inserted with their original ids, inside a
 * single transaction. Tables absent from the file are left untouched.
 */

export const DATA_FORMAT = "iq-data-export";
export const DATA_FORMAT_VERSION = 1;

/** Rows per INSERT — PostgreSQL allows at most 65535 bind params per statement. */
const IMPORT_CHUNK = 200;

/** Preview sample values are truncated so a whiteboard scene doesn't bloat it. */
const SAMPLE_TRUNCATE = 120;

interface TransferTable {
  key: string;
  label: string;
  table: any;
  /** FK columns (drizzle property names) -> target table key. */
  refs: Record<string, string>;
}

/** Parents before children (insert order); deletion walks the reverse. */
const TABLE_ORDER: TransferTable[] = [
  { key: "levels", label: "Niveaux", table: levels, refs: {} },
  { key: "users", label: "Utilisateurs", table: users, refs: {} },
  { key: "fields", label: "Filières", table: fields, refs: { created_by: "users" } },
  { key: "professors", label: "Professeurs", table: professors, refs: { field_id: "fields" } },
  { key: "groups", label: "Groupes", table: groups, refs: { prof_id: "professors" } },
  { key: "students", label: "Étudiants", table: students, refs: { group_id: "groups" } },
  { key: "student_assignments", label: "Inscriptions", table: studentAssignments, refs: { student_id: "students", group_id: "groups" } },
  { key: "time_slots", label: "Créneaux horaires", table: timeSlots, refs: {} },
  { key: "classrooms", label: "Salles", table: classrooms, refs: {} },
  { key: "working_hours", label: "Horaires de travail", table: workingHours, refs: {} },
  { key: "hierarchy_configurations", label: "Configurations de navigation", table: hierarchyConfigurations, refs: {} },
  { key: "professor_compensations", label: "Rémunérations", table: professorCompensations, refs: { prof_id: "professors" } },
  { key: "student_payments", label: "Paiements étudiants", table: studentPayments, refs: { student_id: "students", group_id: "groups" } },
  { key: "payment_transactions", label: "Transactions", table: paymentTransactions, refs: { payment_id: "student_payments" } },
  { key: "payroll_payments", label: "Paiements professeurs", table: payrollPayments, refs: { prof_id: "professors" } },
  { key: "payroll_documents", label: "Documents de paie", table: payrollDocuments, refs: { payout_id: "payroll_payments" } },
  { key: "schedule_entries", label: "Séances d'emploi du temps", table: scheduleEntries, refs: { group_id: "groups", time_slot_id: "time_slots", classroom_id: "classrooms", prof_id: "professors" } },
  { key: "student_schedule_exceptions", label: "Exceptions d'élèves", table: studentScheduleExceptions, refs: { student_id: "students", schedule_entry_id: "schedule_entries" } },
  { key: "schedule_entry_exceptions", label: "Exceptions de séances", table: scheduleEntryExceptions, refs: { schedule_entry_id: "schedule_entries", new_time_slot_id: "time_slots", new_classroom_id: "classrooms", new_prof_id: "professors" } },
  { key: "attendance_sheets", label: "Feuilles de présence", table: attendanceSheets, refs: { group_id: "groups" } },
  { key: "whiteboards", label: "Tableaux blancs", table: whiteboards, refs: { owner_id: "users" } },
  { key: "receipt_counters", label: "Compteurs de reçus", table: receiptCounters, refs: {} },
  { key: "financial_settings", label: "Paramètres financiers", table: financialSettings, refs: {} },
  { key: "system_settings", label: "Paramètres système", table: systemSettings, refs: {} },
];

const TABLE_BY_KEY = new Map(TABLE_ORDER.map((def) => [def.key, def]));

export interface ExportDocument {
  app: string;
  format: string;
  formatVersion: number;
  sourceVersion: string;
  exportedAt: string;
  tables: Record<string, { columns: string[]; rows: unknown[][] }>;
}

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

@Injectable()
export class DataTransferService {
  private readonly logger = new Logger(DataTransferService.name);
  private readonly sourceVersion: string;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf-8"));
      this.sourceVersion = pkg.version ?? "unknown";
    } catch {
      this.sourceVersion = "unknown";
    }
  }

  // ------------------------------------------------------------------
  // Export
  // ------------------------------------------------------------------

  async exportAll(): Promise<{ buffer: Buffer; filename: string }> {
    const document: ExportDocument = {
      app: "iq-academy",
      format: DATA_FORMAT,
      formatVersion: DATA_FORMAT_VERSION,
      sourceVersion: this.sourceVersion,
      exportedAt: new Date().toISOString(),
      tables: {},
    };

    for (const def of TABLE_ORDER) {
      const columns = Object.keys(getTableColumns(def.table));
      const rows = await this.db.client.select().from(def.table);
      document.tables[def.key] = {
        columns,
        rows: rows.map((row) => columns.map((column) => (row as Record<string, unknown>)[column] ?? null)),
      };
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return {
      buffer: Buffer.from(JSON.stringify(document)),
      filename: `iq-academy-data-${stamp}.json`,
    };
  }

  // ------------------------------------------------------------------
  // Preview
  // ------------------------------------------------------------------

  async previewImport(buffer: Buffer, fileName: string, phrase?: string): Promise<ImportPreview> {
    buffer = await this.resolveImportBuffer(buffer, phrase);
    const document = this.parseDocument(buffer);
    const tables: TablePreview[] = [];
    const ignoredTables: string[] = [];

    for (const key of Object.keys(document.tables)) {
      const def = TABLE_BY_KEY.get(key);
      if (!def) {
        ignoredTables.push(key);
        continue;
      }
      tables.push(this.previewTable(def, document.tables[key], document.tables));
    }

    return {
      fileName,
      sourceVersion: document.sourceVersion ?? null,
      exportedAt: document.exportedAt ?? null,
      formatVersion: document.formatVersion,
      tables,
      ignoredTables,
      errors: [],
    };
  }

  // ------------------------------------------------------------------
  // Import
  // ------------------------------------------------------------------

  async importAll(
    buffer: Buffer,
    fills: Record<string, Record<string, string>>,
    actorUserId: string,
    fileName?: string,
    phrase?: string,
  ): Promise<ImportResult> {
    buffer = await this.resolveImportBuffer(buffer, phrase);
    const document = this.parseDocument(buffer);
    const fillsSafe = fills && typeof fills === "object" ? fills : {};

    // Per-table insert plan, validated against the current schema.
    const plans: { def: TransferTable; rows: Record<string, unknown>[] }[] = [];
    for (const def of TABLE_ORDER) {
      const fileTable = document.tables[def.key];
      if (!fileTable) continue;

      const opts = fillsSafe[def.key] ?? {};
      if (String(opts.skip) === "true") continue;

const current = getTableColumns(def.table) as Record<string, any>;
      const fileColumns = fileTable.columns.filter((column) => current[column]);

      if (fileTable.rows.length > 0) {
        // Every NOT NULL column without a default must be present in the file
        // or provided as a fill value — otherwise the insert fails and the
        // whole transaction is lost. Fail the import before opening one.
        for (const [column, col] of Object.entries(current)) {
          const required = col.notNull && !col.hasDefault;
          if (!required || fileColumns.includes(column)) continue;
          const fill = opts[column];
          if (fill === undefined || String(fill).trim() === "") {
            throw new BadRequestException(
              `Import ${def.label} impossible : la colonne « ${column} » manque dans le fichier. ` +
                `Renseignez-la dans l'aperçu (une valeur pour toutes les lignes) avant d'importer.`,
            );
          }
        }

        // Foreign keys pointing at tables absent from the file cannot resolve.
        for (const [column, target] of Object.entries(def.refs)) {
          if (document.tables[target] || !fileColumns.includes(column)) continue;
          const used = fileTable.rows.some((row) => {
            const index = fileTable.columns.indexOf(column);
            const value = row[index];
            return value !== null && value !== undefined && String(value).trim() !== "";
          });
          if (used) {
            throw new BadRequestException(
              `Import ${def.label} impossible : la colonne « ${column} » référence la table ` +
                `« ${TABLE_BY_KEY.get(target)?.label ?? target} » qui n'est pas dans le fichier. ` +
                `Importez un fichier d'export complet ou excluez cette table.`,
            );
          }
        }
      }

      const rows = fileTable.rows.map((row) => this.buildRow(current, fileTable.columns, row, opts));
      plans.push({ def, rows });
    }

    if (plans.length === 0) {
      throw new BadRequestException("Le fichier ne contient aucune table connue.");
    }

    const imported: Record<string, number> = {};
    await this.db.client.transaction(async (tx) => {
      // The acting admin must survive the import: the file's users replace the
      // current rows, and a file from another school has no row for them.
      const [me] = await tx
        .select()
        .from(users)
        .where(eq(users.id, actorUserId))
        .limit(1);

      // Delete in dependency order: children before parents.
      for (const plan of [...plans].reverse()) {
        await tx.delete(plan.def.table);
      }

      for (const plan of plans) {
        if (plan.rows.length === 0) continue;
        for (let i = 0; i < plan.rows.length; i += IMPORT_CHUNK) {
          await tx.insert(plan.def.table).values(plan.rows.slice(i, i + IMPORT_CHUNK));
        }
        imported[plan.def.key] = plan.rows.length;
      }

      if (me) {
        const [exists] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, actorUserId))
          .limit(1);
        if (!exists) {
          await tx.insert(users).values(me);
        }
      }
    });

    await this.audit.createLog(actorUserId, "system.data-import", "system", null, {
      fileName: fileName ?? null,
      exportedAt: document.exportedAt ?? null,
      sourceVersion: document.sourceVersion ?? null,
      imported,
    });

    this.logger.log(`Data import applied: ${JSON.stringify(imported)}`);

    const total = Object.values(imported).reduce((sum, count) => sum + count, 0);
    return {
      success: true,
      message: `Import terminé : ${total} lignes réparties sur ${plans.length} table(s).`,
      imported,
    };
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /**
   * Accepts either a plain `iq-data-export` JSON file or an encrypted
   * `data_export` object (`{school}/exports/*.json.zst.enc`) as uploaded to
   * Dropbox by every snapshot. The envelope header is plaintext and carries
   * its own KDF parameters, so the phrase alone re-derives the key — the same
   * zero-knowledge property as the snapshot restore, but ending in the
   * Importer instead of `psql`.
   */
  private async resolveImportBuffer(buffer: Buffer, phrase?: string): Promise<Buffer> {
    if (this.looksLikeJson(buffer)) return buffer;
    if (!phrase?.trim()) {
      throw new BadRequestException(
        "Ce fichier est chiffré (copie Dropbox) — saisissez la phrase de récupération (12 mots) pour le déchiffrer.",
      );
    }
    let header;
    try {
      ({ header } = splitObject(buffer));
    } catch {
      throw new BadRequestException("Impossible de lire ce fichier — est-ce un export .json ou .enc valide ?");
    }
    if (header.kind !== "data_export") {
      throw new BadRequestException(
        `Ce fichier chiffré est une capture « ${header.kind} », pas un export de données — restaurez-le depuis « Restaurer une sauvegarde » sur la page de connexion.`,
      );
    }
    const key = await deriveKey(phrase.trim(), header.kdf);
    try {
      const { plaintext } = await decodeObject(buffer, key);
      return plaintext;
    } catch {
      throw new BadRequestException(
        "Phrase de récupération invalide pour ce fichier — vérifiez l'ordre et l'orthographe des 12 mots.",
      );
    }
  }

  /** Plain exports start with `{` (after whitespace); encrypted objects start with a u32 length. */
  private looksLikeJson(buffer: Buffer): boolean {
    for (const byte of buffer) {
      if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
      return byte === 0x7b;
    }
    return false;
  }

  private parseDocument(buffer: Buffer): ExportDocument {
    let document: ExportDocument;
    try {
      document = JSON.parse(buffer.toString("utf-8"));
    } catch {
      throw new BadRequestException("Impossible de lire ce fichier — est-ce un export .json valide ?");
    }
    if (document?.format !== DATA_FORMAT || document?.app !== "iq-academy") {
      throw new BadRequestException(
        "Ce fichier n'est pas un export de données IQ Academy (format « iq-data-export » introuvable).",
      );
    }
    if (typeof document.tables !== "object" || document.tables === null) {
      throw new BadRequestException("Ce fichier d'export ne contient aucune table.");
    }
    return document;
  }

  private previewTable(
    def: TransferTable,
    fileTable: { columns: string[]; rows: unknown[][] },
    documentTables: ExportDocument["tables"],
  ): TablePreview {
    const current = getTableColumns(def.table) as Record<string, any>;
    const fileSet = new Set(fileTable.columns);

    const missingRequired: TableColumnIssue[] = [];
    const missingOptional: TableColumnIssue[] = [];
    for (const [column, col] of Object.entries(current)) {
      if (fileSet.has(column)) continue;
      const issue = { column, type: this.describeType(col.columnType) };
      if (col.notNull && !col.hasDefault) missingRequired.push(issue);
      else missingOptional.push(issue);
    }

    const extraColumns = fileTable.columns.filter((column) => !current[column]);
    const missingTargetTables: { column: string; targetLabel: string }[] = [];
    for (const [column, target] of Object.entries(def.refs)) {
      if (!fileSet.has(column)) continue;
      const targetDef = TABLE_BY_KEY.get(target);
      if (targetDef && documentTables[target]) continue;
      missingTargetTables.push({ column, targetLabel: targetDef?.label ?? target });
    }

    const sampleRows = fileTable.rows.slice(0, 3).map((row) => {
      const out: Record<string, string> = {};
      fileTable.columns.forEach((column, index) => {
        if (!current[column]) return;
        out[column] = this.truncateSample(row[index]);
      });
      return out;
    });

    return {
      table: def.key,
      label: def.label,
      columnsPresent: fileTable.columns.filter((column) => current[column]),
      missingRequired,
      missingOptional,
      extraColumns,
      missingTargetTables,
      rowCount: fileTable.rows.length,
      sampleRows,
    };
  }

  private truncateSample(value: unknown): string {
    if (value === null || value === undefined) return "";
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (text.length <= SAMPLE_TRUNCATE) return text;
    return `${text.slice(0, SAMPLE_TRUNCATE)}…`;
  }

  private describeType(columnType: string): string {
    switch (columnType) {
      case "PgBoolean": return "oui / non";
      case "PgInteger": case "PgSmallInteger": case "PgBigInt": case "PgReal": case "PgDoublePrecision": return "nombre";
      case "PgNumeric": return "montant";
      case "PgTimestamp": case "PgDate": return "date";
      case "PgTime": return "heure (HH:MM)";
      case "PgJsonb": case "PgJson": return "JSON";
      case "PgUUID": return "identifiant";
      default: return "texte";
    }
  }

  private buildRow(
    current: Record<string, any>,
    fileColumns: string[],
    row: unknown[],
    opts: Record<string, string>,
  ): Record<string, unknown> {
    if (!Array.isArray(row)) {
      throw new BadRequestException(
        "Le fichier contient des lignes invalides (une ligne doit être un tableau de valeurs aligné sur les colonnes).",
      );
    }
    const out: Record<string, unknown> = {};
    for (let i = 0; i < fileColumns.length; i++) {
      const column = fileColumns[i];
      const col = current[column];
      if (!col) continue;
      const value = this.coerce(col, row[i]);
      if (value !== null) out[column] = value;
    }
    for (const [column, fill] of Object.entries(opts)) {
      if (!current[column] || out[column] !== undefined) continue;
      if (fill === undefined || String(fill).trim() === "") continue;
      const value = this.coerce(current[column], fill);
      if (value !== null) out[column] = value;
    }
    return out;
  }

  private coerce(col: any, raw: unknown): unknown {
    if (raw === null || raw === undefined) return null;
    if (raw === "") return null;

    switch (col.columnType) {
      case "PgBoolean": {
        if (typeof raw === "boolean") return raw;
        const text = String(raw).trim().toLowerCase();
        if (["true", "1", "oui", "yes", "on", "vrai"].includes(text)) return true;
        if (["false", "0", "non", "no", "off", "faux"].includes(text)) return false;
        throw new BadRequestException(`Valeur invalide pour une colonne oui/non : « ${raw} »`);
      }
      case "PgInteger":
      case "PgSmallInteger":
      case "PgBigInt": {
        const number = Number(String(raw).replace(/[^\d-]/g, ""));
        if (!Number.isInteger(number)) {
          throw new BadRequestException(`Valeur invalide pour une colonne nombre entier : « ${raw} »`);
        }
        return number;
      }
      case "PgNumeric": {
        const text = String(raw).replace(/\s/g, "").replace(",", ".");
        if (!/^-?\d+(\.\d+)?$/.test(text)) {
          throw new BadRequestException(`Valeur invalide pour une colonne montant : « ${raw} »`);
        }
        return Number(text);
      }
      case "PgReal":
      case "PgDoublePrecision": {
        const number = Number(raw);
        if (Number.isNaN(number)) throw new BadRequestException(`Valeur numérique invalide : « ${raw} »`);
        return number;
      }
      case "PgTimestamp":
      case "PgDate": {
        const date = raw instanceof Date ? raw : new Date(String(raw));
        if (Number.isNaN(date.getTime())) {
          throw new BadRequestException(`Valeur de date invalide : « ${raw} » (attendu : AAAA-MM-JJ)`);
        }
        return date;
      }
      case "PgJsonb":
      case "PgJson": {
        if (typeof raw === "object") return raw;
        try {
          return JSON.parse(String(raw));
        } catch {
          throw new BadRequestException(`Valeur JSON invalide : « ${String(raw).slice(0, 60)} »`);
        }
      }
      case "PgTime":
      case "PgUUID":
      case "PgEnum":
      default:
        return String(raw);
    }
  }
}