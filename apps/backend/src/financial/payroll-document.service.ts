import { Injectable, NotFoundException } from "@nestjs/common";
import { PayrollDocumentType, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { FinancialSettingsService } from "./financial-settings.service";
import { RevenueCalculationService } from "./revenue-calculation.service";
import { ReceiptNumberService } from "./receipt-number.service";
import { Money, ZERO, money, round2, toAmount } from "./money.util";
import { periodOfDate, parsePeriod } from "./period.util";

/** Everything either document is rendered from, frozen at generation time. */
export interface SettlementSnapshot {
  document: {
    type: PayrollDocumentType;
    no: string;
    title: string;
    generated_at: string;
  };
  academy: {
    name: string;
    address: string;
    phone: string;
    currency: string;
    currency_locale: string;
  };
  professor: {
    id: string;
    full_name: string;
    phone: string;
    email: string | null;
    level: string | null;
    field: string | null;
  };
  payout: {
    id: string;
    receipt_number: string | null;
    amount: string;
    paid_at: string;
    notes: string | null;
    recorded_by_name: string | null;
  };
  period: { label: string; academic_year: string };
  formula: {
    model: string;
    percentage: string | null;
    fixed_amount: string | null;
    custom_formula: string | null;
    is_override: boolean;
    description: string;
  };
  totals: {
    student_count: number;
    group_count: number;
    revenue: string;
    professor_share: string;
    school_share: string;
    earned_from_collections: string;
    earned_fixed: string;
    total_earned: string;
    amount_paid: string;
    remaining_balance: string;
    status: string;
  };
  verification: { revenue: string; professor_share: string; school_share: string; verified: boolean };
  groups: {
    group: string;
    students: number;
    revenue: string;
    professor_share: string;
    school_share: string;
  }[];
}

type Db = Prisma.TransactionClient | PrismaService;

const MONTHS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

/**
 * Printable payroll settlement documents — the two A4 papers that come out of
 * every payroll payment, reproducing the academy's manual Excel workbook:
 *
 *  - the professor's payment receipt, handed to the professor;
 *  - the school's financial settlement report, kept internal.
 *
 * Both are rendered from a snapshot frozen at generation time and stored on the
 * `payroll_documents` row, so a reprint months later shows exactly what was
 * settled that day — never a recomputation under a formula that changed since.
 *
 * The templates are deliberately separate from the settlement arithmetic:
 * `settlementForPeriod` answers "what happened this month", and the two content
 * templates below only lay figures out. Customising a header, adding a logo or
 * a signature block touches the template methods, never the numbers.
 */
@Injectable()
export class PayrollDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: FinancialSettingsService,
    private readonly revenue: RevenueCalculationService,
    private readonly receipts: ReceiptNumberService,
  ) {}

  // ---------------------------------------------------------------------------
  // Settlement arithmetic
  // ---------------------------------------------------------------------------

  /**
   * The full settlement picture for one professor and one period.
   *
   * The split invariant is checked here and recorded on the document:
   * `professor_share + school_share` must equal the collected revenue exactly —
   * the revenue engine guarantees it per transaction (school share is the
   * remainder by subtraction, never its own rounding), so a mismatch would
   * surface as a verification failure on the printed paper rather than silently
   * drifting into the books.
   */
  async settlementForPeriod(
    profId: string,
    period?: string,
    db: Db = this.prisma,
  ): Promise<SettlementSnapshot> {
    const target = period && period.trim() ? period : periodOfDate(new Date());
    const [professor, entitlement, rule, shares, paid, settings] = await Promise.all([
      db.professors.findUnique({
        where: { id: profId },
        include: { field: { include: { level: true } } },
      }),
      this.revenue.periodEntitlement(profId, target),
      this.revenue.ruleFor(profId),
      db.payment_transactions.aggregate({
        where: { prof_id: profId, period: target },
        _sum: { amount: true, professor_share: true, school_share: true },
      }),
      db.payroll_payments.aggregate({
        where: { prof_id: profId, period: target },
        _sum: { amount: true },
      }),
      this.settings.get(),
    ]);

    if (!professor) throw new NotFoundException(`Professor ${profId} not found`);

    const revenue = round2(money(shares._sum.amount));
    const professorShare = round2(money(shares._sum.professor_share));
    const schoolShare = round2(money(shares._sum.school_share));
    const amountPaid = round2(money(paid._sum.amount));
    const earned = entitlement.total;
    const balance = round2(earned.minus(amountPaid));

    return {
      document: {
        type: "school_settlement",
        no: "",
        title: "",
        generated_at: new Date().toISOString(),
      },
      academy: {
        name: settings.academy_name,
        address: settings.academy_address,
        phone: settings.academy_phone,
        currency: settings.currency,
        currency_locale: settings.currency_locale,
      },
      professor: {
        id: professor.id,
        full_name: professor.full_name,
        phone: professor.phone,
        email: professor.email,
        level: professor.field?.level?.name ?? null,
        field: professor.field?.name ?? null,
      },
      payout: {
        id: "",
        receipt_number: null,
        amount: "",
        paid_at: "",
        notes: null,
        recorded_by_name: null,
      },
      period: { label: target, academic_year: this.academicYearLabel(target, settings.academic_year_start_month) },
      formula: {
        model: rule.model,
        percentage: rule.percentage !== null ? toAmount(rule.percentage) : null,
        fixed_amount: rule.fixedAmount !== null ? toAmount(rule.fixedAmount) : null,
        custom_formula: rule.customFormula,
        is_override: rule.isOverride,
        description: this.formulaDescription(rule),
      },
      totals: {
        student_count: entitlement.studentCount,
        group_count: entitlement.groupCount,
        revenue: toAmount(revenue),
        professor_share: toAmount(professorShare),
        school_share: toAmount(schoolShare),
        earned_from_collections: toAmount(entitlement.fromCollections),
        earned_fixed: toAmount(entitlement.fixedComponent),
        total_earned: toAmount(earned),
        amount_paid: toAmount(amountPaid),
        remaining_balance: toAmount(balance),
        status: this.statusLabel(earned, amountPaid),
      },
      verification: {
        revenue: toAmount(revenue),
        professor_share: toAmount(professorShare),
        school_share: toAmount(schoolShare),
        verified: professorShare.plus(schoolShare).equals(revenue),
      },
      groups: await this.groupBreakdown(db, profId, target),
    };
  }

  /** Per-group rows for the settlement table, mirroring the Excel workbook. */
  private async groupBreakdown(db: Db, profId: string, period: string) {
    const txns = await db.payment_transactions.findMany({
      where: { prof_id: profId, period },
      select: {
        amount: true,
        professor_share: true,
        school_share: true,
        payment: {
          select: {
            student: { select: { id: true } },
            group: { select: { id: true, name: true } },
          },
        },
      },
    });

    const byGroup = new Map<
      string,
      { group: string; students: Set<string>; revenue: Money; professorShare: Money; schoolShare: Money }
    >();

    for (const txn of txns) {
      // The invoice's own group — the enrollment the money was billed under.
      const key = txn.payment?.group?.id ?? "unassigned";
      const name = txn.payment?.group?.name ?? "Sans groupe";
      let row = byGroup.get(key);
      if (!row) {
        row = { group: name, students: new Set(), revenue: ZERO, professorShare: ZERO, schoolShare: ZERO };
        byGroup.set(key, row);
      }
      row.students.add(txn.payment?.student?.id ?? "unknown");
      row.revenue = row.revenue.plus(money(txn.amount));
      row.professorShare = row.professorShare.plus(money(txn.professor_share));
      row.schoolShare = row.schoolShare.plus(money(txn.school_share));
    }

    return Array.from(byGroup.values())
      .map((row) => ({
        group: row.group,
        students: row.students.size,
        revenue: toAmount(round2(row.revenue)),
        professor_share: toAmount(round2(row.professorShare)),
        school_share: toAmount(round2(row.schoolShare)),
      }))
      .sort((a, b) => a.group.localeCompare(b.group, "fr"));
  }

  private statusLabel(earned: Money, paid: Money): string {
    if (paid.greaterThanOrEqualTo(earned)) return "paid";
    if (paid.greaterThan(0)) return "partial";
    return "unpaid";
  }

  /** "Septembre 2026 · Année 2026/27" for the period block. */
  private academicYearLabel(period: string, startMonth: number): string {
    const { year, month } = parsePeriod(period);
    const label = `${MONTHS_FR[month]} ${year}`;
    const yearStart =
      month >= startMonth - 1 ? year : year - 1;
    return `${label} · Année ${yearStart}/${String(yearStart + 1).slice(-2)}`;
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

  // ---------------------------------------------------------------------------
  // Generation
  // ---------------------------------------------------------------------------

  /**
   * Mints both documents for a payout inside the caller's transaction.
   *
   * Must be handed the same `tx` as the payout write so the settlement reference
   * number is reserved atomically with the money movement — if the payout rolls
   * back, the number is released with it, and the two documents can never exist
   * for a payout that was never recorded.
   */
  async generateForPayout(tx: Prisma.TransactionClient, payoutId: string, userId: string) {
    const payout = await tx.payroll_payments.findUnique({
      where: { id: payoutId },
      include: {
        professor: true,
        recorder: { select: { full_name: true } },
      },
    });
    if (!payout) throw new NotFoundException(`Payroll payment ${payoutId} not found`);

    const period = payout.period ?? periodOfDate(payout.paid_at);
    const snapshot = await this.settlementForPeriod(payout.prof_id, period, tx);
    snapshot.payout = {
      id: payout.id,
      receipt_number: payout.receipt_number,
      amount: toAmount(money(payout.amount)),
      paid_at: payout.paid_at.toISOString(),
      notes: payout.notes,
      recorded_by_name: payout.recorder?.full_name ?? null,
    };

    const settlementNo = await this.receipts.next(tx, "settlement", payout.paid_at);
    const now = new Date();

    const rows = await Promise.all([
      this.mint(tx, {
        payoutId,
        type: "professor_receipt",
        documentNo: payout.receipt_number ?? payout.id.slice(0, 8).toUpperCase(),
        title: "Reçu de Règlement Professeur",
        period,
        generatedBy: userId,
        generatedAt: now,
        snapshot: { ...snapshot, document: { type: "professor_receipt", no: payout.receipt_number ?? payout.id.slice(0, 8).toUpperCase(), title: "Reçu de Règlement Professeur", generated_at: now.toISOString() } },
      }),
      this.mint(tx, {
        payoutId,
        type: "school_settlement",
        documentNo: settlementNo,
        title: "Rapport de Règlement Financier",
        period,
        generatedBy: userId,
        generatedAt: now,
        snapshot: { ...snapshot, document: { type: "school_settlement", no: settlementNo, title: "Rapport de Règlement Financier", generated_at: now.toISOString() } },
      }),
    ]);

    await this.audit.record({
      action: "payroll.documents_generated",
      entityType: "payroll_payment",
      entityId: payoutId,
      entityLabel: `${payout.professor.full_name} · ${period} · ${rows.length} documents`,
      actorId: userId,
      meta: {
        prof_id: payout.prof_id,
        period,
        settlement_no: settlementNo,
        receipt_no: payout.receipt_number,
      },
    });

    return rows;
  }

  private async mint(
    tx: Prisma.TransactionClient,
    input: {
      payoutId: string;
      type: PayrollDocumentType;
      documentNo: string;
      title: string;
      period: string;
      generatedBy: string;
      generatedAt: Date;
      snapshot: SettlementSnapshot;
    },
  ) {
    return tx.payroll_documents.create({
      data: {
        payout_id: input.payoutId,
        type: input.type,
        document_no: input.documentNo,
        title: input.title,
        period: input.period,
        generated_by: input.generatedBy,
        generated_at: input.generatedAt,
        data: input.snapshot as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** Re-issues the pair of documents, e.g. after a payout was corrected. */
  async regenerate(payoutId: string, userId: string) {
    const payout = await this.prisma.payroll_payments.findUnique({ where: { id: payoutId } });
    if (!payout) throw new NotFoundException(`Payroll payment ${payoutId} not found`);

    return this.prisma.$transaction((tx) => this.generateForPayout(tx, payoutId, userId));
  }

  // ---------------------------------------------------------------------------
  // Reading back
  // ---------------------------------------------------------------------------

  async listForPayout(payoutId: string) {
    const docs = await this.prisma.payroll_documents.findMany({
      where: { payout_id: payoutId },
      include: { generator: { select: { full_name: true } } },
      orderBy: { generated_at: "desc" },
    });
    return docs.map((doc) => this.summary(doc));
  }

  /** Every settlement paper for a professor, newest first — the reprint list. */
  async listForProfessor(profId: string, period?: string) {
    const payouts = await this.prisma.payroll_payments.findMany({
      where: { prof_id: profId, ...(period ? { period } : {}) },
      select: { id: true },
      orderBy: { paid_at: "desc" },
      take: 200,
    });
    const docs = await this.prisma.payroll_documents.findMany({
      where: { payout_id: { in: payouts.map((p) => p.id) } },
      include: {
        generator: { select: { full_name: true } },
        payout: { select: { id: true, period: true, paid_at: true } },
      },
      orderBy: { generated_at: "desc" },
      take: 400,
    });
    return docs.map((doc) => this.summary(doc));
  }

  private summary(doc: {
    id: string;
    type: PayrollDocumentType;
    document_no: string;
    title: string;
    period: string | null;
    generated_by: string | null;
    generated_at: Date;
    generator: { full_name: string } | null;
    payout?: { id: string; period: string | null; paid_at: Date };
  }) {
    return {
      id: doc.id,
      type: doc.type,
      document_no: doc.document_no,
      title: doc.title,
      period: doc.period,
      generated_at: doc.generated_at.toISOString(),
      generated_by: doc.generator?.full_name ?? null,
      payout_id: doc.payout?.id ?? null,
      payout_period: doc.payout?.period ?? null,
      payout_paid_at: doc.payout?.paid_at.toISOString() ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /**
   * The print-ready A4 document. PDF is not a separate pipeline: the browser's
   * own print dialogue (which includes "Save as PDF" on every modern machine)
   * prints this HTML exactly as the CSS lays it out — the same convention the
   * quittances and report exports already follow.
   */
  async render(docId: string, logoUrl?: string | null): Promise<string> {
    const doc = await this.prisma.payroll_documents.findUnique({
      where: { id: docId },
      include: { generator: { select: { full_name: true } } },
    });
    if (!doc) throw new NotFoundException(`Settlement document ${docId} not found`);

    const snapshot = doc.data as unknown as SettlementSnapshot;
    if (doc.type === "school_settlement") return this.schoolSettlementHtml(snapshot, logoUrl);
    return this.professorReceiptHtml(snapshot, logoUrl);
  }

  /** The professor's copy — the official payroll receipt handed to them. */
  private professorReceiptHtml(s: SettlementSnapshot, logoUrl?: string | null): string {
    const fmt = this.formatters(s);
    const balance = Number(s.totals.remaining_balance);

    return this.shell(s, {
      title: s.document.title,
      watermark: false,
      logoUrl,
      body: `
        <div class="details">
          <table class="kv">
            <tr><td>Numéro de reçu</td><td><strong>${this.escape(s.document.no)}</strong></td></tr>
            <tr><td>Professeur</td><td><strong>${this.escape(s.professor.full_name)}</strong></td></tr>
            <tr><td>Téléphone</td><td>${this.escape(s.professor.phone || "—")}</td></tr>
            <tr><td>Niveau</td><td>${this.escape(s.professor.level ?? "—")}</td></tr>
            <tr><td>Filière</td><td>${this.escape(s.professor.field ?? "—")}</td></tr>
            <tr><td>Période de règlement</td><td>${this.escape(this.periodLine(s))}</td></tr>
            <tr><td>Nombre d'étudiants inclus</td><td>${s.totals.student_count}</td></tr>
            <tr><td>Formule appliquée</td><td>${this.escape(s.formula.description)}</td></tr>
            <tr><td>Date de paiement</td><td>${fmt.date(s.payout.paid_at)}</td></tr>
            <tr><td>Enregistré par</td><td>${this.escape(s.payout.recorded_by_name ?? "—")}</td></tr>
            ${s.payout.notes ? `<tr><td>Notes</td><td>${this.escape(s.payout.notes)}</td></tr>` : ""}
          </table>
        </div>

        <h2 class="section">Règlement</h2>

        <div class="amount-due">
          <div class="label">Gain du professeur</div>
          <div class="value">${fmt.money(s.totals.total_earned)}</div>
          <div class="subline">
            dont ${fmt.money(s.totals.earned_from_collections)} encaissements + ${fmt.money(s.totals.earned_fixed)} élément fixe
          </div>
        </div>

        <div class="settled">
          <div class="settled-box">
            <div class="label">Montant versé</div>
            <div class="value">${fmt.money(s.payout.amount)}</div>
            <div class="date">le ${fmt.date(s.payout.paid_at)}</div>
          </div>
          <div class="settled-box">
            <div class="label">Solde restant</div>
            <div class="value ${balance > 0 ? "negative" : ""}">${fmt.money(s.totals.remaining_balance)}</div>
            <div class="date">${balance > 0 ? "à régler sur les prochains encaissements" : "règlement soldé"}</div>
          </div>
        </div>

        <div class="signatures">
          <div class="sig">
            <div class="line"></div>
            <div class="label">Signature du Professeur</div>
          </div>
          <div class="sig">
            <div class="line"></div>
            <div class="label">Signature de l'Administrateur</div>
          </div>
        </div>
      `,
    });
  }

  /** The school's internal accounting document — never given to the professor. */
  private schoolSettlementHtml(s: SettlementSnapshot, logoUrl?: string | null): string {
    const fmt = this.formatters(s);
    const statusLabel = this.statusFr(s.totals.status);

    return this.shell(s, {
      title: s.document.title,
      watermark: true,
      logoUrl,
      body: `
        <div class="details">
          <table class="kv">
            <tr><td>Référence</td><td><strong>${this.escape(s.document.no)}</strong></td></tr>
            <tr><td>Professeur</td><td><strong>${this.escape(s.professor.full_name)}</strong></td></tr>
            <tr><td>Niveau / Filière</td><td>${this.escape(`${s.professor.level ?? "—"} · ${s.professor.field ?? "—"}`)}</td></tr>
            <tr><td>Période</td><td>${this.escape(this.periodLine(s))}</td></tr>
            <tr><td>Formule de répartition</td><td>${this.escape(s.formula.description)}</td></tr>
            <tr><td>Statut du règlement</td><td>${statusLabel}</td></tr>
            <tr><td>Date de paiement</td><td>${fmt.date(s.payout.paid_at)}</td></tr>
            <tr><td>Généré par</td><td>${this.escape(s.payout.recorded_by_name ?? "—")}</td></tr>
            ${s.payout.notes ? `<tr><td>Notes internes</td><td>${this.escape(s.payout.notes)}</td></tr>` : ""}
          </table>
        </div>

        <h2 class="section">Répartition des encaissements</h2>
        <table class="data">
          <thead>
            <tr><th>Groupe</th><th class="right">Étudiants</th><th class="right">Revenu total</th><th class="right">Part professeur</th><th class="right">Part académie</th></tr>
          </thead>
          <tbody>
            ${this.groupRows(s)}
          </tbody>
          <tfoot>
            <tr><td colspan="2">Total</td><td class="right">${fmt.money(s.totals.revenue)}</td><td class="right">${fmt.money(s.totals.professor_share)}</td><td class="right">${fmt.money(s.totals.school_share)}</td></tr>
            <tr class="check ${s.verification.verified ? "ok" : "bad"}">
              <td colspan="5">
                ${s.verification.verified
                  ? `✓ Vérifié : professeur + académie = 100% du revenu (${fmt.money(s.verification.professor_share)} + ${fmt.money(s.verification.school_share)} = ${fmt.money(s.verification.revenue)})`
                  : `✗ ÉCART DE RÉPARTITION : ${fmt.money(s.verification.professor_share)} + ${fmt.money(s.verification.school_share)} ≠ ${fmt.money(s.verification.revenue)}`}
              </td>
            </tr>
          </tfoot>
        </table>

        <div class="breakdown">
          <div class="breakdown-bar">
            <div class="breakdown-bar-fill" style="width: ${this.percentOfRevenue(s)}%"></div>
          </div>
          <div class="breakdown-legend">
            <div><span class="dot prof"></span>Part professeur ${fmt.money(s.totals.professor_share)}</div>
            <div><span class="dot school"></span>Part académie ${fmt.money(s.totals.school_share)}</div>
            <div><span class="dot total"></span>Revenu total ${fmt.money(s.totals.revenue)}</div>
          </div>
        </div>

        <div class="amount-due">
          <div class="label">Gain de l'académie</div>
          <div class="value">${fmt.money(s.totals.school_share)}</div>
          <div class="subline">
            ${fmt.money(s.totals.revenue)} d'encaissements − ${fmt.money(s.totals.professor_share)} part professeur
          </div>
        </div>

        <div class="settled">
          <div class="settled-box">
            <div class="label">Gain total du professeur</div>
            <div class="value">${fmt.money(s.totals.total_earned)}</div>
            <div class="date">encaissements ${fmt.money(s.totals.earned_from_collections)} + fixe ${fmt.money(s.totals.earned_fixed)}</div>
          </div>
          <div class="settled-box">
            <div class="label">Montant versé</div>
            <div class="value">${fmt.money(s.payout.amount)}</div>
            <div class="date">solde non réglé : <strong class="${Number(s.totals.remaining_balance) > 0 ? "negative" : ""}">${fmt.money(s.totals.remaining_balance)}</strong></div>
          </div>
        </div>

        <p class="internal-note">
          Document interne — réservé à l'administration de ${this.escape(s.academy.name)}.
          Ne pas remettre au professeur.
        </p>
      `,
    });
  }

  /** Professor share as a 0-100 fraction of revenue, for the visual bar. */
  private percentOfRevenue(s: SettlementSnapshot): number {
    const revenue = Number(s.verification.revenue);
    if (revenue <= 0) return 0;
    const pct = (Number(s.verification.professor_share) / revenue) * 100;
    return Math.min(100, Math.max(0, Math.round(pct * 10) / 10));
  }

  private groupRows(s: SettlementSnapshot): string {
    const fmt = this.formatters(s);
    if (s.groups.length === 0) {
      return `<tr><td colspan="5" class="empty">Aucun encaissement pour cette période.</td></tr>`;
    }
    return s.groups
      .map(
        (g) => `
        <tr>
          <td>${this.escape(g.group)}</td>
          <td class="right">${g.students}</td>
          <td class="right">${fmt.money(g.revenue)}</td>
          <td class="right">${fmt.money(g.professor_share)}</td>
          <td class="right">${fmt.money(g.school_share)}</td>
        </tr>`,
      )
      .join("");
  }

  private periodLine(s: SettlementSnapshot): string {
    return `${s.period.label} · ${s.period.academic_year}`;
  }

  private statusFr(status: string): string {
    switch (status) {
      case "paid":
        return "PAYÉ";
      case "partial":
        return "PARTIELLEMENT PAYÉ";
      default:
        return "NON PAYÉ";
    }
  }

  private formatters(s: SettlementSnapshot) {
    const currency = new Intl.NumberFormat(s.academy.currency_locale, {
      style: "currency",
      currency: s.academy.currency,
      minimumFractionDigits: 2,
    });
    const date = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
    return {
      money: (value: string) => currency.format(Number(value)),
      date: (value: string | Date | null) => (value ? date.format(new Date(value)) : "—"),
    };
  }

  private escape(value: unknown): string {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------------------------------------------------------------------------
  // Shared A4 shell
  // ---------------------------------------------------------------------------

  /**
   * The one layout both documents share — the modular part the academy can
   * customise (logo, header, footer, colours) without touching the settlement
   * arithmetic above.
   */
  private shell(
    s: SettlementSnapshot,
    input: { title: string; watermark: boolean; logoUrl?: string | null; body: string },
  ): string {
    const brand = this.escape(s.academy.name);
    const address = this.escape(s.academy.address);
    const phone = this.escape(s.academy.phone);
    const no = this.escape(s.document.no);
    const title = this.escape(input.title);

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — ${brand}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 12px; }
    .page { max-width: 186mm; margin: 0 auto; position: relative; }
    .no-print { display: none; }
    header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #264EBE; padding-bottom: 10px; margin-bottom: 14px; }
    .brand h1 { color: #264EBE; font-size: 22px; letter-spacing: .01em; }
    .brand .coords { color: #6b7280; font-size: 10px; margin-top: 3px; line-height: 1.5; }
    .brand .logo { height: 44px; width: auto; max-width: 90mm; object-fit: contain; display: block; margin-bottom: 6px; }
    .doc-ref { text-align: right; font-size: 10px; color: #6b7280; }
    .doc-ref strong { display: block; color: #264EBE; font-size: 13px; margin-top: 2px; }
    h2.section { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #264EBE; margin: 16px 0 8px; }
    .details { margin-bottom: 4px; }
    table.kv { width: 100%; border-collapse: collapse; }
    .kv td { padding: 4px 0; border-bottom: 1px solid #eef1f6; vertical-align: top; }
    .kv td:first-child { width: 34%; color: #6b7280; font-size: 11px; }
    table.data { width: 100%; border-collapse: collapse; margin-top: 4px; }
    .data th, .data td { padding: 5px 7px; border-bottom: 1px solid #e5e7eb; text-align: left; }
    .data th { background: #264EBE; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: .02em; }
    .data tfoot td { font-weight: 700; border-top: 2px solid #264EBE; background: #f0f4ff; }
    .right { text-align: right; font-variant-numeric: tabular-nums; }
    .check { font-size: 10px; }
    .check.ok td { color: #15803d; background: #f0fdf4; }
    .check.bad td { color: #b91c1c; background: #fef2f2; font-weight: 700; }
    .empty { text-align: center; color: #9ca3af; padding: 18px; }
    .amount-due { text-align: center; margin: 18px 0 0; padding: 12px; background: #f0f4ff; border-radius: 8px; }
    .amount-due .label { font-size: 11px; color: #6b7280; }
    .amount-due .value { font-size: 22px; font-weight: 700; color: #264EBE; margin: 2px 0; }
    .amount-due .subline { font-size: 10px; color: #6b7280; }
    .settled { display: flex; gap: 10px; margin-top: 14px; }
    .settled-box { flex: 1; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; text-align: center; }
    .settled-box .label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: .03em; }
    .settled-box .value { font-size: 18px; font-weight: 700; color: #264EBE; margin: 3px 0; }
    .settled-box .date { font-size: 10px; color: #6b7280; }
    .negative { color: #b91c1c !important; }
    .breakdown { margin-top: 14px; }
    .breakdown-bar { height: 10px; border-radius: 6px; background: #e0e7ff; overflow: hidden; }
    .breakdown-bar-fill { height: 100%; background: #264EBE; }
    .breakdown-legend { display: flex; justify-content: space-between; margin-top: 6px; font-size: 10px; color: #6b7280; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: baseline; }
    .dot.prof { background: #264EBE; }
    .dot.school { background: #e0e7ff; }
    .dot.total { background: #6b7280; }
    .signatures { display: flex; gap: 40px; margin-top: 42px; }
    .sig { flex: 1; text-align: center; }
    .sig .line { border-bottom: 1px solid #1f2937; height: 44px; }
    .sig .label { font-size: 10px; color: #6b7280; margin-top: 5px; }
    .internal-note { margin-top: 18px; font-size: 9px; color: #b91c1c; border: 1px dashed #b91c1c; border-radius: 6px; padding: 6px 8px; }
    footer { margin-top: 22px; padding-top: 8px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 9px; color: #9ca3af; }
    .watermark { position: absolute; top: 40%; left: 0; right: 0; transform: rotate(-28deg); text-align: center; font-size: 44px; font-weight: 700; color: rgba(185, 28, 28, .07); letter-spacing: .12em; pointer-events: none; }
    @media screen {
      body { background: #eef1f6; padding: 20px; }
      .page { background: #fff; padding: 14mm; box-shadow: 0 2px 14px rgba(0,0,0,.12); }
      .no-print { display: flex; gap: 8px; margin-bottom: 10px; }
      .no-print button { background: #264EBE; color: #fff; border: 0; border-radius: 6px; padding: 8px 16px; font-size: 12px; cursor: pointer; }
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
    ${input.watermark ? `<div class="watermark">DOCUMENT INTERNE</div>` : ""}
    <header>
      <div class="brand">
        ${input.logoUrl ? `<img class="logo" src="${this.escape(input.logoUrl)}" alt="${brand}">` : ""}
        <h1>${brand}</h1>
        <div class="coords">
          ${address ? `${this.escape(address)}<br>` : ""}${phone ? `${phone}<br>` : ""}
          ${brand} — Gestion des règlements
        </div>
      </div>
      <div class="doc-ref">
        ${title}
        <strong>${no}</strong>
      </div>
    </header>
    ${input.body}
    <footer>
      <div>${brand} — document généré le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(s.document.generated_at))}</div>
      <div>${this.escape(s.document.no)}</div>
    </footer>
  </div>
</body>
</html>`;
  }
}
