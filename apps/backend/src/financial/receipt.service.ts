import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FinancialSettingsService } from "./financial-settings.service";
import { AuditService } from "../audit/audit.service";
import { money, round2, toAmount } from "./money.util";

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
      logoUrl,
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

    return this.document({
      title: "Reçu de Paiement Professeur",
      brand: settings.academy_name,
      logoUrl,
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
        ...(payout.notes ? ([["Notes", payout.notes]] as [string, string][]) : []),
      ],
      ledger: "",
      headlineLabel: "Montant versé",
      headlineValue: fmt.currency(Number(payout.amount)),
      subline: "",
    });
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
  <title>${this.escape(input.title)} - ${brand}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
    .receipt { max-width: 640px; margin: 0 auto; border: 1px solid #ddd; padding: 30px; }
    .header { text-align: center; border-bottom: 2px solid #264EBE; padding-bottom: 20px; margin-bottom: 20px; }
    .header .logo { height: 56px; width: auto; max-width: 60mm; object-fit: contain; margin-bottom: 8px; }
    .header h1 { color: #264EBE; font-size: 24px; margin-bottom: 5px; }
    .header p { color: #666; font-size: 14px; }
    .receipt-title { text-align: center; font-size: 18px; font-weight: bold; margin-bottom: 20px; color: #264EBE; }
    .details table { width: 100%; border-collapse: collapse; }
    .details td { padding: 8px 0; border-bottom: 1px solid #eee; }
    .details td:first-child { font-weight: bold; width: 42%; color: #555; }
    .ledger { margin-top: 22px; }
    .ledger h3 { font-size: 13px; color: #264EBE; margin-bottom: 8px; text-transform: uppercase; letter-spacing: .03em; }
    .ledger-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .ledger-table th { background: #f0f4ff; color: #264EBE; text-align: left; padding: 6px 8px; font-size: 11px; text-transform: uppercase; }
    .ledger-table td { padding: 6px 8px; border-bottom: 1px solid #eee; }
    .right { text-align: right; font-variant-numeric: tabular-nums; }
    .negative { color: #b91c1c; }
    .amount-due { text-align: center; margin: 25px 0 0; padding: 15px; background: #f0f4ff; border-radius: 8px; }
    .amount-due .label { font-size: 14px; color: #666; margin-bottom: 5px; }
    .amount-due .value { font-size: 28px; font-weight: bold; color: #264EBE; }
    .amount-due .subline { font-size: 12px; color: #6b7280; margin-top: 6px; }
    .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #999; }
    @media print { body { padding: 20px; } .receipt { border: none; } }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      ${input.logoUrl ? `<img class="logo" src="${this.escape(input.logoUrl)}" alt="${brand}">` : ""}
      <h1>${brand}</h1>
      <p>Reçu de Paiement</p>
    </div>
    <div class="receipt-title">${this.escape(input.title)}</div>
    <div class="details"><table>${details}</table></div>
    ${input.ledger}
    <div class="amount-due">
      <div class="label">${this.escape(input.headlineLabel)}</div>
      <div class="value">${this.escape(input.headlineValue)}</div>
      ${input.subline ? `<div class="subline">${this.escape(input.subline)}</div>` : ""}
    </div>
    <div class="footer"><p>${brand} &mdash; Merci pour votre paiement.</p></div>
  </div>
</body>
</html>`;
  }
}
