import { Injectable } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Workbook } from "exceljs";
import { FinancialSettingsService } from "./financial-settings.service";
import type { ReportTable } from "./financial-report.service";

/** Everything a controller needs to stream a file back. */
export interface ExportedFile {
  filename: string;
  contentType: string;
  body: Buffer | string;
}

/**
 * Turns a `ReportTable` into a downloadable file.
 *
 * One neutral table shape in, three formats out â€” so a column added to a report
 * appears in every export without touching this file, and CSV, Excel and the
 * printable document can never disagree about what the report contained.
 *
 * PDF is produced as a print-ready HTML document rather than by adding a
 * rendering engine. The academy already prints its quittances this way, every
 * Windows machine can "Print to PDF" from the browser, and a headless Chromium
 * would be a ~300 MB dependency to reproduce a layout the browser is already
 * showing. The document opens its own print dialogue and is styled for A4.
 */
@Injectable()
export class FinancialExportService {
  constructor(private readonly settings: FinancialSettingsService) {}

  async export(report: ReportTable, format: "csv" | "excel" | "pdf"): Promise<ExportedFile> {
    // The academy's locale decides both the CSV delimiter and the number format
    // exported â€” a file that opens as one long column is not a report.
    const settings = await this.settings.get();
    const locale = settings.currency_locale;
    const csvDelimiter = locale.startsWith("fr") ? ";" : ",";
    const currencySymbol =
      new Intl.NumberFormat(locale, { style: "currency", currency: report.currency })
        .formatToParts(0)
        .find((p) => p.type === "currency")?.value ?? report.currency;
    const brand = settings.academy_name || "School Management System";
    const logo = await this.inlineLogo(settings.logo_path);

    switch (format) {
      case "csv":
        return this.toCsv(report, csvDelimiter);
      case "excel":
        return this.toExcel(report, currencySymbol);
      case "pdf":
      default:
        return this.toPrintableHtml(report, brand, logo);
    }
  }

  /**
   * The printed document opens in a bare tab, so a remote <img> can race or
   * fail before the renderer grabs it. Read the logo file and embed it as a
   * data URI instead; null when no logo is set.
   */
  private async inlineLogo(logoPath: string | null | undefined): Promise<string | null> {
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

  private slug(report: ReportTable): string {
    const date = report.generated_at.slice(0, 10);
    return `${report.type.replace(/_/g, "-")}-${date}`;
  }

  /**
   * RFC 4180 quoting throughout, with a locale-aware separator.
   *
   * The BOM is deliberate: Excel on a French or Arabic Windows install opens a
   * BOM-less UTF-8 CSV in the system codepage, which turns every accented name
   * in the academy's roster into mojibake. The separator matters just as much:
   * Excel uses the system's list separator, which is ";" on French regional
   * settings â€” a comma-separated file opens there as one endless column.
   */
  private toCsv(report: ReportTable, delimiter: string): ExportedFile {
    const escape = (value: unknown): string => {
      if (value === null || value === undefined) return "";
      const text = String(value);
      return new RegExp(`[",\\n\\r${delimiter}]`).test(text)
        ? `"${text.replace(/"/g, '""')}"`
        : text;
    };

    const lines: string[] = [];
    lines.push(escape(report.title));
    lines.push(escape(`GÃ©nÃ©rÃ© le ${report.generated_at} Â· de ${report.range.from} Ã  ${report.range.to}`));
    lines.push("");
    lines.push(report.columns.map((c) => escape(c.label)).join(delimiter));

    for (const row of report.rows) {
      lines.push(report.columns.map((c) => escape(row[c.key])).join(delimiter));
    }

    if (report.totals) {
      lines.push(report.columns.map((c) => escape(report.totals?.[c.key])).join(delimiter));
    }

    for (const note of report.footnotes) {
      lines.push("");
      lines.push(escape(note));
    }

    return {
      filename: `${this.slug(report)}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: "ï»¿" + lines.join("\r\n"),
    };
  }

  private async toExcel(report: ReportTable, currencySymbol: string): Promise<ExportedFile> {
    const workbook = new Workbook();
    workbook.creator = "School Management System";
    workbook.created = new Date(report.generated_at);

    const sheet = workbook.addWorksheet(report.title.slice(0, 30), {
      views: [{ state: "frozen", ySplit: 4 }],
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    const titleRow = sheet.addRow([report.title]);
    titleRow.font = { size: 14, bold: true, color: { argb: "FF264EBE" } };
    sheet.mergeCells(1, 1, 1, Math.max(report.columns.length, 1));

    const metaRow = sheet.addRow([
      `GÃ©nÃ©rÃ© le ${new Date(report.generated_at).toLocaleString("fr-FR")} Â· ` +
        `${report.range.from.slice(0, 10)} au ${report.range.to.slice(0, 10)} Â· ${report.currency}`,
    ]);
    metaRow.font = { size: 9, italic: true, color: { argb: "FF6B7280" } };
    sheet.mergeCells(2, 1, 2, Math.max(report.columns.length, 1));

    sheet.addRow([]);

    const header = sheet.addRow(report.columns.map((c) => c.label));
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF264EBE" } };
    header.alignment = { vertical: "middle" };
    header.height = 20;

    for (const row of report.rows) {
      const added = sheet.addRow(
        report.columns.map((column) => {
          const value = row[column.key];
          // Numeric columns go in as numbers, not text, or the recipient cannot
          // sum a column in the spreadsheet they just downloaded.
          if (column.numeric && value !== null && value !== undefined && value !== "") {
            const parsed = Number(value);
            return isNaN(parsed) ? value : parsed;
          }
          return value ?? "";
        }),
      );

      report.columns.forEach((column, index) => {
        if (column.numeric) {
          // The number format carries the currency symbol, like the cells on
          // screen (the separator is the viewer's own regional setting, so the
          // file renders as "1 500,00 DT" on a French Excel and "1,500.00 DT"
          // on an English one).
          added.getCell(index + 1).numFmt = `#,##0.00" ${currencySymbol}"`;
          added.getCell(index + 1).alignment = { horizontal: "right" };
        }
      });
    }

    if (report.totals) {
      const totals = sheet.addRow(
        report.columns.map((column) => {
          const value = report.totals?.[column.key];
          if (column.numeric && value !== null && value !== undefined && value !== "") {
            const parsed = Number(value);
            return isNaN(parsed) ? value : parsed;
          }
          return value ?? "";
        }),
      );
      totals.font = { bold: true, color: { argb: "FF264EAE" } };
      totals.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEFB" } };
      totals.border = { top: { style: "thin", color: { argb: "FF264EAE" } } };
      report.columns.forEach((column, index) => {
        if (column.numeric) {
          totals.getCell(index + 1).numFmt = `#,##0.00" ${currencySymbol}"`;
          totals.getCell(index + 1).alignment = { horizontal: "right" };
        }
      });
    }

    if (report.footnotes.length > 0) {
      sheet.addRow([]);
      for (const note of report.footnotes) {
        const noteRow = sheet.addRow([note]);
        noteRow.font = { size: 9, italic: true, color: { argb: "FF6B7280" } };
      }
    }

    report.columns.forEach((column, index) => {
      const longest = report.rows.reduce(
        (max, row) => Math.max(max, String(row[column.key] ?? "").length),
        column.label.length,
      );
      sheet.getColumn(index + 1).width = Math.min(Math.max(longest + 2, 10), 40);
    });

    const buffer = await workbook.xlsx.writeBuffer();

    return {
      filename: `${this.slug(report)}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: Buffer.from(buffer),
    };
  }

  private toPrintableHtml(report: ReportTable, brand: string, logo: string | null): ExportedFile {
    const escape = (value: unknown): string =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const head = report.columns
      .map((c) => `<th class="${c.align === "right" || c.numeric ? "right" : ""}">${escape(c.label)}</th>`)
      .join("");

    const body = report.rows
      .map(
        (row) =>
          `<tr>${report.columns
            .map(
              (c) =>
                `<td class="${c.align === "right" || c.numeric ? "right" : ""}">${escape(row[c.key])}</td>`,
            )
            .join("")}</tr>`,
      )
      .join("");

    const totals = report.totals
      ? `<tfoot><tr>${report.columns
          .map(
            (c) =>
              `<td class="${c.align === "right" || c.numeric ? "right" : ""}">${escape(
                report.totals?.[c.key],
              )}</td>`,
          )
          .join("")}</tr></tfoot>`
      : "";

    const notes = report.footnotes.length
      ? `<div class="notes">${report.footnotes.map((n) => `<p>${escape(n)}</p>`).join("")}</div>`
      : "";

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escape(report.title)} â€” ${escape(brand)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; color: #1f2937; margin: 0; padding: 24px; font-size: 12px; }
  header { border-bottom: 2px solid #264EBE; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end; }
  h1 { color: #264EBE; font-size: 20px; margin: 0 0 4px; }
  .meta { color: #6b7280; font-size: 11px; }
  .brand { text-align: right; font-weight: 700; color: #264EBE; font-size: 16px; }
  .brand .logo { height: 60px; width: auto; max-width: 55mm; object-fit: contain; display: block; margin-left: auto; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  th { background: #264EBE; color: #fff; font-size: 11px; text-transform: uppercase; letter-spacing: .02em; }
  .right { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr:nth-child(even) { background: #f9fafb; }
  tfoot td { font-weight: 700; border-top: 2px solid #264EBE; background: #f0f4ff; }
  .notes { margin-top: 16px; color: #6b7280; font-size: 10px; }
  .notes p { margin: 2px 0; }
  .empty { padding: 32px; text-align: center; color: #9ca3af; }
  @media print {
    body { padding: 0; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <header>
    <div>
      <h1>${escape(report.title)}</h1>
      <div class="meta">
        du ${escape(report.range.from.slice(0, 10))} au ${escape(report.range.to.slice(0, 10))}
        &middot; ${escape(report.currency)}
        &middot; gÃ©nÃ©rÃ© le ${escape(new Date(report.generated_at).toLocaleString("fr-FR"))}
      </div>
    </div>
    <div class="brand">
      ${logo ? `<img class="logo" src="${logo}" alt="${escape(brand)}">` : ""}
      <div>${escape(brand)}</div>
    </div>
  </header>
  ${
    report.rows.length === 0
      ? `<div class="empty">Aucune donnÃ©e pour les filtres sÃ©lectionnÃ©s.</div>`
      : `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${totals}</table>`
  }
  ${notes}
  <script>window.addEventListener("load", function () { window.print(); });</script>
</body>
</html>`;

    return {
      filename: `${this.slug(report)}.html`,
      contentType: "text/html; charset=utf-8",
      body: html,
    };
  }
}
