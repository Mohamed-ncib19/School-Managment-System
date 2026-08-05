import { Injectable } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import { AttendanceSession, AttendanceStudent } from "./attendance.types";

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

/**
 * The same monthly register as an Excel file, so teachers who keep their marks
 * on a spreadsheet can keep the workflow without retyping the roster.
 *
 * Mirrors the printed A4 layout: title block, yellow info panel, blue session
 * header row with the séance numbers, and the student rows with blank cells.
 */
@Injectable()
export class AttendanceExportService {
  async exportExcel(
    input: {
      academy_name: string;
    },
    context: {
      month: number;
      year: number;
      academic_year: string | null;
      schedule: string | null;
      teacher_name: string;
      level_name: string;
      field_name: string | null;
      group_name: string;
      students: AttendanceStudent[];
      sessions: AttendanceSession[];
    },
  ): Promise<{ buffer: Buffer; filename: string }> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = input.academy_name;
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(`Feuille de présence ${context.month}-${context.year}`, {
      pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    const PRIMARY = "264EAE";
    const LIGHT = "DCEEFF";
    const YELLOW = "F8E8A5";
    const sessions = context.sessions;
    const totalCols = 4 + sessions.length + 1; // # | name | phone | sessions… | remarks

    const thinBorder: Partial<ExcelJS.Borders> = {
      top: { style: "thin", color: { argb: PRIMARY } },
      left: { style: "thin", color: { argb: PRIMARY } },
      bottom: { style: "thin", color: { argb: PRIMARY } },
      right: { style: "thin", color: { argb: PRIMARY } },
    };

    // Title block ------------------------------------------------------------
    const title = sheet.getCell(1, 1);
    title.value = `${input.academy_name} — Feuille de Présence Mensuelle`;
    title.font = { name: "Calibri", size: 15, bold: true, color: { argb: PRIMARY } };
    sheet.mergeCells(1, 1, 1, totalCols);

    const sub = sheet.getCell(2, 1);
    sub.value = context.academic_year
      ? `Année académique ${context.academic_year} · ${MONTHS_FR[context.month - 1]} ${context.year}`
      : `${MONTHS_FR[context.month - 1]} ${context.year}`;
    sub.font = { name: "Calibri", size: 11, color: { argb: "374151" } };
    sheet.mergeCells(2, 1, 2, totalCols);

    // Info panel (soft yellow) -----------------------------------------------
    const infoRows = [
      ["Professeur", context.teacher_name],
      ["Mois", `${MONTHS_FR[context.month - 1]} ${context.year}`],
      ["Niveau", context.level_name],
      ["Filière", context.field_name ?? "—"],
      ["Groupe", context.group_name],
      ["Séances", String(sessions.length)],
    ];
    infoRows.forEach(([k, v], idx) => {
      const row = sheet.getRow(4 + Math.floor(idx / 3));
      const col = 1 + (idx % 3) * 2;
      const kCell = row.getCell(col);
      kCell.value = k;
      kCell.font = { name: "Calibri", size: 9, bold: true, color: { argb: PRIMARY } };
      kCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } };
      kCell.alignment = { vertical: "middle", horizontal: "center" };
      const vCell = row.getCell(col + 1);
      vCell.value = v;
      vCell.font = { name: "Calibri", size: 10, bold: true };
      vCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } };
      vCell.alignment = { vertical: "middle", horizontal: "left" };
      [kCell, vCell].forEach((c) => (c.border = thinBorder));
    });

    // Schedule banner (light blue) -------------------------------------------
    const scheduleLine = context.schedule ? context.schedule.replace(/\s*\r?\n\s*/g, " · ") : "";
    if (scheduleLine) {
      const sRow = sheet.getRow(7);
      sRow.getCell(1).value = "Emploi du temps";
      sRow.getCell(1).font = { name: "Calibri", size: 9, bold: true, color: { argb: PRIMARY } };
      sRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
      sRow.getCell(1).border = thinBorder;
      const sVal = sRow.getCell(2);
      sVal.value = scheduleLine;
      sVal.font = { name: "Calibri", size: 10, bold: true };
      sVal.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
      sVal.border = thinBorder;
      sheet.mergeCells(7, 2, 7, totalCols);
    }

    // Header row -------------------------------------------------------------
    const h1 = sheet.getRow(scheduleLine ? 9 : 8);
    h1.getCell(1).value = "#";
    h1.getCell(2).value = "Nom de l'étudiant";
    h1.getCell(3).value = "Téléphone";
    sessions.forEach((_, i) => (h1.getCell(4 + i).value = `Séance ${i + 1}`));
    h1.getCell(4 + sessions.length).value = "Présence";
    this.styleHeaderRow(h1, totalCols, PRIMARY);
    const headerRowNumber = h1.number;

    // Student rows ------------------------------------------------------------
    context.students.forEach((s, idx) => {
      const row = sheet.getRow(headerRowNumber + 1 + idx);
      row.getCell(1).value = idx + 1;
      row.getCell(2).value = `${s.last_name ?? ""} ${s.first_name ?? ""}`.trim();
      row.getCell(3).value = s.phone?.trim() ?? "";
      for (let c = 4; c < 4 + sessions.length; c++) {
        row.getCell(c).value = "";
      }
      row.getCell(4 + sessions.length).value = "";
      for (let c = 1; c <= totalCols; c++) {
        row.getCell(c).border = thinBorder;
        row.getCell(c).alignment = { vertical: "middle", horizontal: c === 2 || c === 3 ? "left" : "center" };
      }
      row.getCell(1).font = { name: "Calibri", size: 10, color: { argb: "374151" } };
      row.getCell(2).font = { name: "Calibri", size: 10, bold: true };
      row.getCell(3).font = { name: "Calibri", size: 10 };
      row.height = 26;
    });

    if (context.students.length === 0) {
      const empty = sheet.getRow(headerRowNumber + 1);
      empty.getCell(1).value = "Aucun étudiant dans ce groupe.";
      empty.getCell(1).font = { name: "Calibri", size: 10, italic: true, color: { argb: "6B7280" } };
      sheet.mergeCells(headerRowNumber + 1, 1, headerRowNumber + 1, totalCols);
    }

    // Signature footer ---------------------------------------------------------
    const adminCol = 4 + sessions.length; // the remarks column
    const sigRow = sheet.getRow(headerRowNumber + context.students.length + 2);
    sigRow.getCell(2).value = "Signature de l'enseignant";
    sigRow.getCell(adminCol).value = "Signature de l'administrateur";
    for (const col of [2, adminCol]) {
      sigRow.getCell(col).border = { top: { style: "medium", color: { argb: PRIMARY } } };
      sigRow.getCell(col).font = { name: "Calibri", size: 10 };
      sigRow.getCell(col).alignment = { horizontal: "center" };
    }

    // Column widths ------------------------------------------------------------
    sheet.getColumn(1).width = 5;
    sheet.getColumn(2).width = 34;
    sheet.getColumn(3).width = 17;
    for (let c = 4; c < 4 + sessions.length; c++) sheet.getColumn(c).width = 10;
    sheet.getColumn(4 + sessions.length).width = 24;

    for (const row of [sheet.getRow(1), sheet.getRow(2)]) {
      for (let c = 1; c <= totalCols; c++) row.getCell(c).alignment = { vertical: "middle", horizontal: "center" };
    }
    sheet.getRow(1).height = 22;
    sheet.getRow(2).height = 16;

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `Feuille de presence ${context.group_name} ${context.month}-${context.year}.xlsx`;
    return { buffer: Buffer.from(buffer), filename };
  }

  private styleHeaderRow(row: ExcelJS.Row, totalCols: number, color: string) {
    for (let c = 1; c <= totalCols; c++) {
      const cell = row.getCell(c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
      cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFF" } };
      cell.alignment = { vertical: "middle", horizontal: c === 2 || c === 3 ? "left" : "center", wrapText: true };
      cell.border = { top: { style: "thin", color: { argb: color } }, bottom: { style: "thin", color: { argb: color } }, left: { style: "thin", color: { argb: color } }, right: { style: "thin", color: { argb: color } } };
    }
    row.height = 20;
  }
}
