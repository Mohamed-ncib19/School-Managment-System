import { Injectable, NotFoundException } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { FinancialSettingsService } from "./financial-settings.service";
import { AuditService } from "../audit/audit.service";
import { PayrollDocumentService } from "./payroll-document.service";
import { money, round2, toAmount, Money } from "./money.util";
import { billingPeriods } from "./billing.util";

/**
 * Printable quittances.
 *
 * Kept in French and laid out as before, because these are handed to parents and
 * the academy's paperwork should not change shape because the software behind it
 * did. What has changed is what a receipt can now say: an invoice settled in
 * three instalments prints all three, with the running balance, rather than a
 * single figure that matches none of the payments actually made.
 */
@Injectable()
export class ReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: FinancialSettingsService,
    private readonly audit: AuditService,
    private readonly payrollDocuments: PayrollDocumentService,
  ) {}

  /** A receipt for one invoice, listing every movement against it. */
  async forPayment(paymentId: string, userId?: string, logoUrl?: string | null): Promise<string> {
    const payment = await this.prisma.student_payments.findUnique({
      where: { id: paymentId },
      include: {
        student: true,
        group: { include: { professor: { include: { field: { include: { level: true } } } } } },
        transactions: { orderBy: { paid_at: "asc" } },
      },
    });
    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);

    const settings = await this.settings.get();
    const student = payment.student;
    // The invoice names the enrollment it covers, so the receipt shows that
    // group — for a multi-group student, the one this quittance bills.
    const group = payment.group;
    const professor = group?.professor;
    const field = professor?.field;
    const level = field?.level;

    const collected = round2(
      payment.transactions.reduce((acc, t) => acc.plus(money(t.amount)), money(0)),
    );
    const balance = round2(money(payment.amount_due).minus(collected));

    // A receipt leaving the building is worth recording — it is the document a
    // dispute will be argued over.
    if (userId) {
      await this.audit.record({
        action: "receipt.generated",
        entityType: "student_payment",
        entityId: paymentId,
        entityLabel: `${payment.period} · ${toAmount(collected)}`,
        actorId: userId,
        meta: { student_id: payment.student_id, period: payment.period },
      });
    }

    const fmt = this.formatters(settings.currency, settings.currency_locale);
    const primaryReceipt =
      payment.transactions.find((t) => t.type === "payment")?.receipt_number ??
      payment.id.slice(0, 8).toUpperCase();

    const rows = payment.transactions
      .map(
        (t) => `
        <tr>
          <td>${fmt.date(t.paid_at)}</td>
          <td>${this.typeLabel(t.type)}</td>
          <td>${t.receipt_number ?? "—"}</td>
          <td class="right ${money(t.amount).isNegative() ? "negative" : ""}">${fmt.currency(Number(t.amount))}</td>
        </tr>`,
      )
      .join("");

    return this.document({
      title: "Quittance de Paiement",
      brand: settings.academy_name,
      logoUrl: await this.inlineLogo(logoUrl),
      receiptNumber: primaryReceipt,
      rows: [
        ["Numéro de quittance", primaryReceipt],
        ["Étudiant", student ? `${student.first_name} ${student.last_name}` : "—"],
        ["Téléphone", student?.phone ?? "—"],
        ["Niveau", level?.name ?? "—"],
        ["Filière", field?.name ?? "—"],
        ["Professeur", professor?.full_name ?? "—"],
        ["Groupe", group?.name ?? "—"],
        ["Période", payment.period],
        ["Date d'échéance", fmt.date(payment.due_date)],
        ["Statut", this.statusLabel(payment.status)],
        ["Montant dû", fmt.currency(Number(payment.amount_due))],
      ],
      ledger:
        payment.transactions.length > 0
          ? `<div class="ledger">
               <h3>Détail des règlements</h3>
               <table class="ledger-table">
                 <thead><tr><th>Date</th><th>Type</th><th>Quittance</th><th class="right">Montant</th></tr></thead>
                 <tbody>${rows}</tbody>
               </table>
             </div>`
          : "",
      headlineLabel: balance.greaterThan(0) ? "Montant payé (solde restant)" : "Montant payé",
      headlineValue: fmt.currency(Number(collected)),
      subline: balance.greaterThan(0)
        ? `Solde restant : ${fmt.currency(Number(balance))}`
        : "Réglé intégralement",
    });
  }

  /** A receipt for money handed to a professor. */
  async forPayroll(payoutId: string, userId?: string, logoUrl?: string | null): Promise<string> {
    const payout = await this.prisma.payroll_payments.findUnique({
      where: { id: payoutId },
      include: {
        professor: { include: { field: { include: { level: true } } } },
        recorder: { select: { full_name: true } },
      },
    });
    if (!payout) throw new NotFoundException(`Payroll payment ${payoutId} not found`);

    const settings = await this.settings.get();
    const fmt = this.formatters(settings.currency, settings.currency_locale);

    // Fetch settlement for the period to get formula and per-group breakdown
    const settlement = await this.payrollDocuments.settlementForPeriod(payout.prof_id, payout.period ?? undefined);
    const formulaDesc = settlement.formula.description;
    const groups = settlement.groups;

    if (userId) {
      await this.audit.record({
        action: "receipt.generated",
        entityType: "payroll_payment",
        entityId: payoutId,
        entityLabel: `${payout.professor.full_name} · ${toAmount(money(payout.amount))}`,
        actorId: userId,
        meta: { prof_id: payout.prof_id, period: payout.period },
      });
    }

    const groupRows: [string, string][] = groups.flatMap((g) => [
      [`Groupe : ${g.group}`, `Étudiants : ${g.students}`],
      [`Encaissements : ${fmt.currency(Number(g.revenue))}`, `Part professeur : ${fmt.currency(Number(g.professor_share))}`],
      [`Part académie : ${fmt.currency(Number(g.school_share))}`, ""],
    ]);

    return this.document({
      title: "Reçu de Paiement Professeur",
      brand: settings.academy_name,
      logoUrl: await this.inlineLogo(logoUrl),
      receiptNumber: payout.receipt_number ?? payout.id.slice(0, 8).toUpperCase(),
      rows: [
        ["Numéro de reçu", payout.receipt_number ?? payout.id.slice(0, 8).toUpperCase()],
        ["Professeur", payout.professor.full_name],
        ["Téléphone", payout.professor.phone],
        ["Niveau", payout.professor.field?.level?.name ?? "—"],
        ["Filière", payout.professor.field?.name ?? "—"],
        ["Période", payout.period ?? "—"],
        ["Date de paiement", fmt.date(payout.paid_at)],
        ["Méthode de paiement", "Espèces"],
        ["Enregistré par", payout.recorder?.full_name ?? "—"],
        ["Formule appliquée", formulaDesc],
        ...(payout.notes ? [["Notes", payout.notes]] as [string, string][] : []),
        ...groupRows,
      ],
      ledger: "",
      headlineLabel: "Montant versé",
      headlineValue: fmt.currency(Number(payout.amount)),
      subline: groups.length > 1 ? `Répartition sur ${groups.length} groupes` : "",
    });
  }

  private formulaDescription(rule: {
    model: string;
    percentage: Money | null;
    fixedAmount: Money | null;
    customFormula: string | null;
    isOverride: boolean;
  }): string {
    const pct = rule.percentage !== null ? `${toAmount(rule.percentage)}%` : null;
    const fixed = rule.fixedAmount !== null ? toAmount(rule.fixedAmount) : null;

    let base: string;
    switch (rule.model) {
      case "fixed_salary":
        base = `Salaire fixe de ${fixed} / mois`;
        break;
      case "fixed_per_student":
        base = `${fixed} par étudiant actif`;
        break;
      case "fixed_per_group":
        base = `${fixed} par groupe actif`;
        break;
      case "hybrid":
        base = `${pct} des encaissements + fixe ${fixed} / mois`;
        break;
      case "custom":
        base = `Formule personnalisée : ${rule.customFormula ?? "—"}`;
        break;
      default:
        base = `${pct} des encaissements`;
    }
    return rule.isOverride ? `${base} (arrangement individuel)` : `${base} (défaut académie)`;
  }

  private formatters(currency: string, locale: string) {
    const currencyFormatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    });
    const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    return {
      currency: (value: number) => currencyFormatter.format(value),
      date: (value: Date | null) => (value ? dateFormatter.format(value) : "—"),
    };
  }

  private typeLabel(type: string): string {
    switch (type) {
      case "refund":
        return "Remboursement";
      case "correction":
        return "Correction";
      default:
        return "Paiement";
    }
  }

  private statusLabel(status: string): string {
    switch (status) {
      case "paid":
        return "PAYÉ";
      case "partially_paid":
        return "PARTIELLEMENT PAYÉ";
      case "overdue":
        return "EN RETARD";
      case "due_soon":
        return "ÉCHÉANCE PROCHE";
      case "cancelled":
        return "ANNULÉ";
      default:
        return "NON PAYÉ";
    }
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
   * before the renderer grabs it. Read the file the URL points to and embed it
   * as a data URI instead; fall back to the remote URL when the file is gone.
   */
  private async inlineLogo(logoUrl?: string | null): Promise<string | null> {
    if (!logoUrl) return null;
    try {
      const pathname = new URL(logoUrl).pathname;
      const data = await readFile(join(process.cwd(), pathname));
      const mime = pathname.endsWith(".webp")
        ? "image/webp"
        : /\.jpe?g$/i.test(pathname)
          ? "image/jpeg"
          : "image/png";
      return `data:${mime};base64,${data.toString("base64")}`;
    } catch {
      return logoUrl;
    }
  }

  /** The shared quittance shell, so both receipt kinds print identically. */
  private document(input: {
    title: string;
    brand: string;
    logoUrl?: string | null;
    receiptNumber: string;
    rows: [string, string][];
    ledger: string;
    headlineLabel: string;
    headlineValue: string;
    subline: string;
  }): string {
    const details = input.rows
      .map(([label, value]) => `<tr><td>${this.escape(label)}</td><td>${this.escape(value)}</td></tr>`)
      .join("");
    const brand = this.escape(input.brand || "IQ Academy");

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escape(input.title)}</title>
  <style>
    /* 80mm thermal roll: the printable strip is ~72mm after the printer's
       own side margins, so the sheet is sized to the paper, not the paper
       to the sheet. Monochrome, compact, tabular — no colour fills, no
       floats, nothing a thermal head renders as a smudge. */
    @page { size: 80mm auto; margin: 2mm 3mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 80mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11px; line-height: 1.35; }
    .receipt { width: 80mm; margin: 0 auto; padding: 1mm 1.5mm; }
    .no-print { display: none; }

    .head { text-align: center; }
    .head .logo { max-width: 56mm; max-height: 24mm; object-fit: contain; }
    .head .brand { font-size: 13px; font-weight: 700; letter-spacing: .02em; margin-top: .5mm; }
    .head .coords { font-size: 9px; color: #555; }

    .ruled { border-top: 1px dashed #999; margin: 2mm 0; }

    .title { text-align: center; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
    .no { text-align: center; font-size: 11px; font-weight: 700; margin-top: .5mm; }

    table.kv { width: 100%; border-collapse: collapse; margin-top: 2mm; }
    .kv td { padding: .6mm 0; border-bottom: 1px dotted #ccc; vertical-align: top; }
    .kv td:first-child { width: 44%; color: #444; }
    .kv td:last-child { text-align: right; font-weight: 700; word-break: break-word; }

    .ledger { margin-top: 2.5mm; }
    .ledger h3 { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 1mm; }
    .ledger-table { width: 100%; border-collapse: collapse; }
    .ledger-table th { font-size: 8.5px; text-transform: uppercase; text-align: left; border-bottom: 1px solid #333; padding: .6mm 0; }
    .ledger-table th.right { text-align: right; }
    .ledger-table td { font-size: 10px; padding: .8mm 0; border-bottom: 1px dotted #ddd; font-variant-numeric: tabular-nums; }
    .ledger-table td.right { text-align: right; }
    .negative { font-weight: 700; }

    .amount { text-align: center; margin: 3mm 0 0; border-top: 1.5px solid #111; border-bottom: 1.5px solid #111; padding: 2.5mm 0; }
    .amount .label { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
    .amount .value { font-size: 17px; font-weight: 700; margin: 1mm 0; }
    .amount .subline { font-size: 10px; }

    .foot { text-align: center; margin-top: 3mm; font-size: 10px; }
    .foot .meta { font-size: 9px; color: #555; margin-top: .5mm; }
    .cut { text-align: center; margin-top: 2.5mm; color: #666; font-size: 9px; letter-spacing: .12em; }

    @media screen {
      body { background: #eef1f6; padding: 12px; }
      .receipt { background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.15); }
      .no-print { display: flex; justify-content: center; gap: 8px; margin-bottom: 12px; }
      .no-print button { background: #111; color: #fff; border: 0; border-radius: 6px; padding: 8px 16px; font-size: 12px; cursor: pointer; }
    }
    @media print {
      body { padding: 0; }
      .receipt { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()">Imprimer</button>
  </div>
  <div class="receipt">
    <div class="head">
      ${input.logoUrl ? `<img class="logo" src="${this.escape(input.logoUrl)}" alt="${brand}">` : ""}
      <div class="brand">${brand}</div>
    </div>
    <div class="ruled"></div>
    <div class="title">${this.escape(input.title)}</div>
    <div class="no">N° ${this.escape(input.receiptNumber)}</div>
    <div class="details"><table class="kv">${details}</table></div>
    ${input.ledger}
    <div class="amount">
      <div class="label">${this.escape(input.headlineLabel)}</div>
      <div class="value">${this.escape(input.headlineValue)}</div>
      ${input.subline ? `<div class="subline">${this.escape(input.subline)}</div>` : ""}
    </div>
    <div class="foot">
      <div>${brand} &mdash; Merci pour votre paiement.</div>
      <div class="meta">${new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date())}</div>
    </div>
    <div class="cut">&bull;&bull;&bull; CUT &bull;&bull;&bull;</div>
  </div>
</body>
</html>`;
  }
}
