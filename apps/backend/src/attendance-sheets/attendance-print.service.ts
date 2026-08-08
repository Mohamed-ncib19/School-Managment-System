import { Injectable } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AttendanceSession, AttendanceStudent } from "./attendance.types";

/**
 * The print-ready A4 attendance register â€” a modern evolution of the academy's
 * paper register: same layout, same colours, now dynamic.
 *
 * PDF is not a separate pipeline: the browser's own print dialogue (which
 * includes "Save as PDF" on every modern machine) prints this HTML exactly as
 * the CSS lays it out â€” the same convention the quittances and settlement
 * documents already follow.
 *
 * Design tokens (locked with the client):
 *   - Primary blue   #264EAE â€” headers, titles, borders, branding
 *   - Light blue     #DCEEFF â€” schedule banner, secondary section headers
 *   - Soft yellow    #F8E8A5 â€” the Professor/Month/Level/Field/Group panel
 *   - White          #FFFFFF â€” student rows and attendance cells
 *
 * Layout rules: A4 portrait, thin blue inner borders with a thicker outer
 * frame, centred attendance cells, headers repeated on every page, student
 * rows never split, and page numbers in the footer.
 */
@Injectable()
export class AttendancePrintService {
  /** The full print-ready document for one saved sheet. */
  render(
    input: {
      academy_name: string;
      logo_url?: string | null;
      generated_by_name?: string | null;
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
      generated_at: Date;
    },
  ): string {
    const brand = this.escape(input.academy_name || "School Management System");
    const title = "Feuille de PrÃ©sence Mensuelle";
    const monthLabel = MONTHS_FR[context.month - 1] ?? String(context.month);
    const sessions = context.sessions;
    const students = context.students;

    const rowHtml = (s: AttendanceStudent, index: number) => `
        <tr>
          <td class="num">${index + 1}</td>
          <td class="name">${this.escape(`${s.last_name ?? ""} ${s.first_name ?? ""}`.trim())}</td>
          <td class="phone">${this.escape(this.studentPhone(s))}</td>
          ${sessions.map(() => `<td class="session">&nbsp;</td>`).join("")}
          <td class="remarks">&nbsp;</td>
        </tr>`;

    /**
     * A4 is ~275mm of usable height; header + panels consume ~55mm and each
     * row ~8.4mm, so roughly 25 rows fit a page. Beyond that the register is
     * split into two equal tables, each on its own page â€” the teacher gets two
     * legible halves instead of a table cut at an arbitrary line, and each
     * page keeps its own headers.
     */
    const ROWS_PER_PAGE = 24;
    const split = students.length > ROWS_PER_PAGE ? Math.ceil(students.length / 2) : students.length;
    const firstHalf = students.slice(0, split);
    const secondHalf = students.slice(split);

    const tableHtml = (rows: AttendanceStudent[], startIndex: number, forcePageBreak: boolean) => `
      <table class="register${forcePageBreak ? " page-break" : ""}">
        <thead>
          <tr>
            <th class="col-num">#</th>
            <th class="col-name">Nom de l'Ã©tudiant</th>
            <th class="col-phone">TÃ©lÃ©phone</th>
            ${sessions.map((_, i) => `<th class="col-session">SÃ©ance ${i + 1}</th>`).join("")}
            <th class="col-remarks remarks-head">PrÃ©sence</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length === 0
            ? `<tr class="empty-row"><td colspan="${3 + sessions.length + 1}">Aucun Ã©tudiant dans ce groupe.</td></tr>`
            : rows.map((s, i) => rowHtml(s, startIndex + i)).join("")}
        </tbody>
      </table>`;

    const tables = tableHtml(firstHalf, 0, false) + tableHtml(secondHalf, split, true);

    const banner = this.bannerHtml(context.schedule);
    const generatedOn = new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric",
    }).format(context.generated_at);

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4 portrait; margin: 11mm 12mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Poppins', 'Inter', Arial, Helvetica, sans-serif;
    color: #1f2937;
    font-size: 11px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { max-width: 186mm; margin: 0 auto; }

  /* Header -------------------------------------------------------------- */
  header { display: flex; align-items: center; gap: 14px; border-bottom: 2.5px solid #264EAE; padding-bottom: 8px; }
  .brand-logo { height: 78px; width: auto; max-width: 52mm; object-fit: contain; }
  .brand-name { color: #264EAE; font-size: 17px; font-weight: 700; letter-spacing: .02em; }
  .brand-sub { color: #6b7280; font-size: 9px; margin-top: 1px; }
  .head-right { margin-left: auto; text-align: right; }
  .head-right .title { color: #264EAE; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; }
  .head-right .year { font-size: 10px; color: #374151; margin-top: 2px; }

  /* Info panel (soft yellow) -------------------------------------------- */
  .info {
    margin-top: 10px;
    background: #F8E8A5;
    border: 1px solid #264EAE;
    border-radius: 6px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
  }
  .info .cell { padding: 5px 9px; border-right: 1px solid rgba(38, 78, 174, .45); }
  .info .cell:nth-child(3n) { border-right: 0; }
  .info .cell:nth-child(n+4) { border-top: 1px solid rgba(38, 78, 174, .45); }
  .info .k { font-size: 8px; text-transform: uppercase; letter-spacing: .08em; color: #264EAE; font-weight: 600; }
  .info .v { font-size: 11.5px; font-weight: 600; color: #1f2937; margin-top: 1px; }

  /* Schedule banner (light blue) ----------------------------------------- */
  .schedule-banner {
    margin-top: 9px;
    background: #DCEEFF;
    border: 1px solid #264EAE;
    border-radius: 6px;
    padding: 6px 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .schedule-banner .label {
    font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em;
    color: #264EAE; white-space: nowrap;
  }
  .schedule-banner .days { font-size: 10.5px; font-weight: 600; color: #1f2937; }
  .schedule-banner .sep { color: #264EAE; margin: 0 3px; }

  /* Register table -------------------------------------------------------- */
  table.register {
    width: 100%;
    margin-top: 9px;
    border-collapse: collapse;
    table-layout: fixed;
    border: 2px solid #264EAE;
  }
  table.register thead { display: table-header-group; }
  table.register tr { page-break-inside: avoid; }
  /* Second half of a large register starts on its own page, and each page
     keeps the full header block above. */
  table.register.page-break { break-before: page; page-break-before: always; }
  table.register th, table.register td {
    border: 1px solid #264EAE;
    text-align: center;
    vertical-align: middle;
  }
  table.register thead th {
    background: #264EAE;
    color: #fff;
    font-size: 9px;
    font-weight: 600;
    padding: 4px 2px;
    line-height: 1.25;
  }
  table.register thead th.remarks-head, table.register thead th.blank { background: #fff; color: #264EAE; }
  table.register td {
    font-size: 9.5px;
    padding: 3px 3px;
    height: 8.4mm;
  }
  td.num { width: 6mm; font-weight: 600; color: #374151; }
  td.name { text-align: left; padding-left: 5px; font-weight: 500; }
  td.phone { text-align: left; padding-left: 4px; color: #374151; }
  td.session { background: #fff; }
  td.remarks { background: #fff; }
  th.col-num { width: 6mm; }
  th.col-name { width: 47mm; text-align: left !important; }
  th.col-phone { width: 23mm; text-align: left !important; }
  th.col-remarks { width: 24mm; }
  /* Sessions share whatever width is left over. */
  th.col-session, td.session { }
  tbody .empty-row td { height: 12mm; text-align: center; color: #6b7280; }

  /* Footer ----------------------------------------------------------------- */
  .signatures {
    display: flex;
    gap: 44px;
    margin-top: 34px;
  }
  .sig { flex: 1; text-align: center; }
  .sig .line { border-bottom: 1.2px solid #264EAE; height: 42px; }
  .sig .label { font-size: 9.5px; color: #374151; margin-top: 5px; font-weight: 500; }

  .meta-footer {
    margin-top: 18px;
    padding-top: 7px;
    border-top: 1px solid #c7d3f0;
    display: flex;
    justify-content: space-between;
    font-size: 8.5px;
    color: #6b7280;
  }
  .meta-footer .pager { font-weight: 600; color: #264EAE; }
  .meta-footer .pager::before { content: "Page " counter(page) " / " counter(pages); }

  /* Screen preview chrome --------------------------------------------------- */
  .no-print { display: none; }
  @media screen {
    body { background: #eef1f6; padding: 22px; }
    .page { background: #fff; padding: 13mm; box-shadow: 0 2px 16px rgba(0,0,0,.14); border-radius: 4px; }
    .no-print {
      display: flex;
      gap: 8px;
      margin: 0 auto 12px;
      max-width: 186mm;
    }
    .no-print button {
      background: #264EAE; color: #fff; border: 0; border-radius: 6px;
      padding: 8px 16px; font-size: 12px; cursor: pointer;
    }
    .no-print button.secondary { background: #fff; color: #264EAE; border: 1px solid #264EAE; }
  }
  @media print {
    body { padding: 0; }
    .page { box-shadow: none; }
  }
</style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()">Imprimer / Enregistrer en PDF</button>
  </div>
  <div class="page">
    <header>
      <div class="head-left">
        ${input.logo_url
          ? `<img class="brand-logo" src="${this.escape(input.logo_url)}" alt="${brand}">`
          : `<div class="brand-name">${brand}</div>`}
      </div>
      <div class="head-right">
        <div class="title">${title}</div>
        <div class="year">${context.academic_year ? `AnnÃ©e acadÃ©mique ${this.escape(context.academic_year)}` : ""}</div>
      </div>
    </header>

    <div class="info">
      <div class="cell"><div class="k">Professeur</div><div class="v">${this.escape(context.teacher_name)}</div></div>
      <div class="cell"><div class="k">Mois</div><div class="v">${monthLabel} ${context.year}</div></div>
      <div class="cell"><div class="k">Niveau</div><div class="v">${this.escape(context.level_name)}</div></div>
      <div class="cell"><div class="k">FiliÃ¨re</div><div class="v">${this.escape(context.field_name ?? "â€”")}</div></div>
      <div class="cell"><div class="k">Groupe</div><div class="v">${this.escape(context.group_name)}</div></div>
      <div class="cell"><div class="k">SÃ©ances</div><div class="v">${sessions.length}</div></div>
    </div>

    ${banner}

    ${tables}

    <div class="signatures">
      <div class="sig">
        <div class="line"></div>
        <div class="label">Signature de l'enseignant</div>
      </div>
      <div class="sig">
        <div class="line"></div>
        <div class="label">Signature de l'administrateur</div>
      </div>
    </div>

    <div class="meta-footer">
      <div>${brand} â€” document gÃ©nÃ©rÃ© le ${generatedOn}${input.generated_by_name ? ` par ${this.escape(input.generated_by_name)}` : ""}</div>
      <div class="pager"></div>
    </div>
  </div>
</body>
</html>`;
  }

  /** The light-blue banner showing the group's weekly teaching schedule. */
  private bannerHtml(schedule: string | null): string {
    const lines = schedule
      ? schedule.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      : [];

    if (lines.length === 0) return "";
    return `
      <div class="schedule-banner">
        <div class="label">Emploi du temps</div>
        <div class="days">${lines.map((l) => `<span>${this.escape(l)}</span>`).join('<span class="sep">Â·</span>')}</div>
      </div>`;
  }

  /**
   * The student's own phone number, or nothing. Empty strings count as
   * missing â€” the register must not fall back to the parent's number, and a
   * student without a phone leaves the cell blank.
   */
  private studentPhone(s: AttendanceStudent): string {
    const phone = s.phone?.trim();
    return phone ?? "";
  }

  private escape(value: unknown): string {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * The printed HTML opens in a bare tab, so a remote <img> can race or fail
   * before the renderer grabs it. Read the logo file from disk and embed it as
   * a data URI instead; without a logo the renderer falls back to the academy
   * name as plain text.
   */
  async inlineLogo(logoPath?: string | null): Promise<string | null> {
    if (!logoPath) return null;
    try {
      const data = await readFile(join(process.cwd(), logoPath));
      const mime = logoPath.endsWith(".webp")
        ? "image/webp"
        : /\.jpe?g$/i.test(logoPath)
          ? "image/jpeg"
          : "image/png";
      return `data:${mime};base64,${data.toString("base64")}`;
    } catch {
      return null;
    }
  }
}

const MONTHS_FR = [
  "Janvier", "FÃ©vrier", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "AoÃ»t", "Septembre", "Octobre", "Novembre", "DÃ©cembre",
];
