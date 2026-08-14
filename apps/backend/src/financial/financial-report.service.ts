import { BadRequestException, Injectable } from "@nestjs/common";
import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { DbService } from "../db/db.service";
import {
  fields,
  groups,
  levels,
  paymentTransactions,
  payrollPayments,
  professors,
  studentAssignments,
  studentPayments,
  students,
  users,
} from "../db/schema";
import { FinancialSettingsService } from "./financial-settings.service";
import { RevenueCalculationService } from "./revenue-calculation.service";
import { AnalyticsService } from "./analytics.service";
import { ZERO, money, ratePercent, round2, toAmount } from "./money.util";
import { AcademicFilter, paymentWhere, professorWhere, resolveRange, studentWhere, transactionWhere } from "./financial.filters";
import { periodOfDate, type DateRange } from "./period.util";
import type { ReportQueryDto, ReportType } from "./dto/analytics.dto";

/** Exported reports are in French, whatever language the desk runs in. */
const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  payment: "Paiement",
  refund: "Remboursement",
  correction: "Correction",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  paid: "Payé",
  partially_paid: "Partiellement payé",
  overdue: "En retard",
  due_soon: "Échéance proche",
  not_paid: "Non payé",
  cancelled: "Annulé",
};

const PAYROLL_STATUS_LABELS: Record<string, string> = {
  paid: "Versé",
  partial: "Partiel",
  unpaid: "Non payé",
};

const COMPENSATION_MODEL_LABELS: Record<string, string> = {
  percentage: "Pourcentage",
  fixed_salary: "Salaire fixe",
  fixed_per_student: "Forfait par étudiant",
  fixed_per_group: "Forfait par groupe",
  hybrid: "Hybride",
  custom: "Personnalisé",
};

/** A report rendered as a table: the exporters turn this into CSV, Excel or PDF. */
export interface ReportTable {
  type: ReportType;
  title: string;
  generated_at: string;
  currency: string;
  range: { from: string; to: string };
  columns: { key: string; label: string; align?: "left" | "right"; numeric?: boolean }[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, string | number | null> | null;
  /** Free-text notes printed under the table — assumptions a reader needs. */
  footnotes: string[];
}

/**
 * Every report the academy can pull, produced as one neutral table shape.
 *
 * Reports and the dashboard share `financial.filters`, so a report opened from a
 * filtered dashboard is scoped identically. A report that quietly scoped
 * differently from the screen it was launched from would be worse than no
 * report at all — the reader has no way to tell the two apart.
 */
@Injectable()
export class FinancialReportService {
  constructor(
    private readonly db: DbService,
    private readonly settings: FinancialSettingsService,
    private readonly revenue: RevenueCalculationService,
    private readonly analytics: AnalyticsService,
  ) {}

  async generate(query: ReportQueryDto): Promise<ReportTable> {
    const type = query.type ?? "collections";
    const settings = await this.settings.get();
    const range = resolveRange(
      query,
      query.granularity ?? "monthly",
      settings.academic_year_start_month,
    );

    const academic: AcademicFilter = {
      levelId: query.levelId,
      fieldId: query.fieldId,
      profId: query.profId,
      groupId: query.groupId,
      studentId: query.studentId,
    };

    const base = {
      type,
      generated_at: new Date().toISOString(),
      currency: settings.currency,
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
    };

    switch (type) {
      case "collections":
        return { ...base, ...(await this.collections(academic, range)) };
      case "outstanding":
        return { ...base, ...(await this.outstanding(academic)) };
      case "professor_payroll":
        return { ...base, ...(await this.professorPayroll(academic, query.period)) };
      case "school_revenue":
        return { ...base, ...(await this.schoolRevenue(academic, range, query)) };
      case "revenue_by_level":
        return { ...base, ...(await this.revenueByDimension("level", query)) };
      case "revenue_by_professor":
        return { ...base, ...(await this.revenueByDimension("professor", query)) };
      case "revenue_by_group":
        return { ...base, ...(await this.revenueByDimension("group", query)) };
      case "revenue_forecast":
        return { ...base, ...(await this.forecast(academic, range)) };
      default:
        throw new BadRequestException(`Type de rapport inconnu : "${type}"`);
    }
  }

  /**
   * Every movement of money in the window, one row per transaction.
   *
   * Read as a flat join rather than a nested relational query. A report is
   * inherently the whole result set — capping it would silently hand somebody a
   * short financial report, which is worse than a slow one — so the saving has
   * to come from making each row cheap rather than from returning fewer.
   *
   * The nested form expanded each transaction into an object graph five levels
   * deep (invoice → student, and invoice → group → professor → field → level),
   * of which the table below reads eleven scalars. Selecting those scalars
   * directly means one flat row per transaction instead of six nested objects,
   * and no second full copy of the ledger in memory while it is mapped.
   */
  private async collections(academic: AcademicFilter, range: DateRange) {
    const rows = await this.db.client
      .select({
        receipt_number: paymentTransactions.receipt_number,
        paid_at: paymentTransactions.paid_at,
        type: paymentTransactions.type,
        period: paymentTransactions.period,
        amount: paymentTransactions.amount,
        professor_share: paymentTransactions.professor_share,
        school_share: paymentTransactions.school_share,
        first_name: students.first_name,
        last_name: students.last_name,
        // The invoice's own group — the enrollment the money was billed under.
        group_name: groups.name,
        professor_name: professors.full_name,
        field_name: fields.name,
        level_name: levels.name,
        recorded_by: users.full_name,
      })
      .from(paymentTransactions)
      .innerJoin(studentPayments, eq(studentPayments.id, paymentTransactions.payment_id))
      .leftJoin(students, eq(students.id, studentPayments.student_id))
      .leftJoin(groups, eq(groups.id, studentPayments.group_id))
      .leftJoin(professors, eq(professors.id, groups.prof_id))
      .leftJoin(fields, eq(fields.id, professors.field_id))
      .leftJoin(levels, eq(levels.id, fields.level_id))
      .leftJoin(users, eq(users.id, paymentTransactions.recorded_by))
      .where(
        and(
          transactionWhere(academic),
          gte(paymentTransactions.paid_at, range.from),
          lte(paymentTransactions.paid_at, range.to),
        ),
      )
      .orderBy(asc(paymentTransactions.paid_at));

    let total = ZERO;
    let professorTotal = ZERO;
    let schoolTotal = ZERO;

    const data = rows.map((row) => {
      total = total.plus(money(row.amount));
      professorTotal = professorTotal.plus(money(row.professor_share));
      schoolTotal = schoolTotal.plus(money(row.school_share));

      return {
        receipt_number: row.receipt_number,
        paid_at: row.paid_at.toISOString().slice(0, 10),
        type: TRANSACTION_TYPE_LABELS[row.type] ?? row.type,
        student: row.first_name ? `${row.first_name} ${row.last_name}` : "—",
        level: row.level_name ?? "—",
        field: row.field_name ?? "—",
        professor: row.professor_name ?? "—",
        group: row.group_name ?? "—",
        period: row.period,
        amount: toAmount(money(row.amount)),
        professor_share: toAmount(money(row.professor_share)),
        school_share: toAmount(money(row.school_share)),
        recorded_by: row.recorded_by ?? "—",
      };
    });

    return {
      title: "Rapport des encaissements",
      columns: [
        { key: "receipt_number", label: "Reçu" },
        { key: "paid_at", label: "Date" },
        { key: "type", label: "Type" },
        { key: "student", label: "Étudiant" },
        { key: "level", label: "Niveau" },
        { key: "field", label: "Filière" },
        { key: "professor", label: "Professeur" },
        { key: "group", label: "Groupe" },
        { key: "period", label: "Période" },
        { key: "amount", label: "Montant", align: "right" as const, numeric: true },
        { key: "professor_share", label: "Part professeur", align: "right" as const, numeric: true },
        { key: "school_share", label: "Part académie", align: "right" as const, numeric: true },
        { key: "recorded_by", label: "Enregistré par" },
      ],
      rows: data,
      totals: {
        receipt_number: `${data.length} transactions`,
        amount: toAmount(round2(total)),
        professor_share: toAmount(round2(professorTotal)),
        school_share: toAmount(round2(schoolTotal)),
      },
      footnotes: [
        "Les remboursements apparaissent en montants négatifs et sont déjà déduits des totaux.",
        "Les parts sont les montants répartis lors de chaque encaissement, pas un recalcul aux taux actuels.",
      ],
    };
  }

  /** Everything still owed, oldest first. */
  private async outstanding(academic: AcademicFilter) {
    const rows = await this.db.client.query.studentPayments.findMany({
      where: and(
        paymentWhere(academic),
        inArray(studentPayments.status, ["not_paid", "due_soon", "overdue", "partially_paid"]),
      ),
      orderBy: (p, { asc }) => [asc(p.due_date)],
      with: {
        student: true,
        group: { with: { professor: { with: { field: { with: { level: true } } } } } },
      },
    });

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    let total = ZERO;

    const data = rows.map((row) => {
      const balance = round2(money(row.amount_due).minus(money(row.paid_amount)));
      total = total.plus(balance);
      const student = row.student;
      const professor = row.group?.professor;

      return {
        student: student ? `${student.first_name} ${student.last_name}` : "—",
        phone: student?.phone ?? "—",
        level: professor?.field?.level?.name ?? "—",
        field: professor?.field?.name ?? "—",
        professor: professor?.full_name ?? "—",
        group: row.group?.name ?? "—",
        period: row.period,
        due_date: row.due_date.toISOString().slice(0, 10),
        days_overdue: row.due_date < today
          ? Math.floor((today.getTime() - row.due_date.getTime()) / 86_400_000)
          : 0,
        status: PAYMENT_STATUS_LABELS[row.status] ?? row.status,
        amount_due: toAmount(money(row.amount_due)),
        paid: toAmount(money(row.paid_amount)),
        balance: toAmount(balance),
      };
    });

    return {
      title: "Paiements en souffrance",
      columns: [
        { key: "student", label: "Étudiant" },
        { key: "phone", label: "Téléphone" },
        { key: "level", label: "Niveau" },
        { key: "field", label: "Filière" },
        { key: "professor", label: "Professeur" },
        { key: "group", label: "Groupe" },
        { key: "period", label: "Période" },
        { key: "due_date", label: "Échéance" },
        { key: "days_overdue", label: "Jours de retard", align: "right" as const, numeric: true },
        { key: "status", label: "Statut" },
        { key: "amount_due", label: "Dû", align: "right" as const, numeric: true },
        { key: "paid", label: "Payé", align: "right" as const, numeric: true },
        { key: "balance", label: "Solde", align: "right" as const, numeric: true },
      ],
      rows: data,
      totals: { student: `${data.length} factures`, balance: toAmount(round2(total)) },
      footnotes: [
        "Les factures annulées sont exclues — elles ont été annulées plutôt que laissées impayées.",
        "Les factures partiellement payées apparaissent au solde restant.",
      ],
    };
  }

  /** What each professor earned and was paid for a period. */
  private async professorPayroll(academic: AcademicFilter, period?: string) {
    const targetPeriod = period ?? periodOfDate(new Date());

    const profRows = await this.db.client.query.professors.findMany({
      where: professorWhere(academic),
      with: { field: { with: { level: true } } },
      orderBy: (p, { asc }) => [asc(p.full_name)],
    });

    if (profRows.length === 0) {
      return {
        title: `Masse salariale — ${targetPeriod}`,
        columns: [{ key: "professor", label: "Professeur" }],
        rows: [],
        totals: null,
        footnotes: [],
      };
    }

    const profIds = profRows.map((p) => p.id);
    const [entitlements, payouts] = await Promise.all([
      this.revenue.periodEntitlements(profIds, targetPeriod),
      this.db.client
        .select({
          prof_id: payrollPayments.prof_id,
          sum_amount: sql<string | null>`sum(${payrollPayments.amount})`,
        })
        .from(payrollPayments)
        .where(and(inArray(payrollPayments.prof_id, profIds), eq(payrollPayments.period, targetPeriod)))
        .groupBy(payrollPayments.prof_id),
    ]);

    const paidMap = new Map(payouts.map((p) => [p.prof_id, money(p.sum_amount)]));

    let earnedTotal = ZERO;
    let paidTotal = ZERO;
    let balanceTotal = ZERO;

    const data = profRows.map((professor) => {
      const entitlement = entitlements.get(professor.id);
      const earned = entitlement?.total ?? ZERO;
      const paid = round2(paidMap.get(professor.id) ?? ZERO);
      const balance = round2(earned.minus(paid));

      earnedTotal = earnedTotal.plus(earned);
      paidTotal = paidTotal.plus(paid);
      balanceTotal = balanceTotal.plus(balance);

      return {
        professor: professor.full_name,
        level: professor.field?.level?.name ?? "—",
        field: professor.field?.name ?? "—",
        model: COMPENSATION_MODEL_LABELS[entitlement?.model ?? "percentage"] ?? entitlement?.model ?? "Pourcentage",
        students: entitlement?.studentCount ?? 0,
        groups: entitlement?.groupCount ?? 0,
        from_collections: toAmount(entitlement?.fromCollections ?? ZERO),
        fixed: toAmount(entitlement?.fixedComponent ?? ZERO),
        earned: toAmount(earned),
        paid: toAmount(paid),
        balance: toAmount(balance),
        status: paid.lessThanOrEqualTo(0)
          ? PAYROLL_STATUS_LABELS.unpaid
          : paid.greaterThanOrEqualTo(earned)
            ? PAYROLL_STATUS_LABELS.paid
            : PAYROLL_STATUS_LABELS.partial,
      };
    });

    return {
      title: `Masse salariale — ${targetPeriod}`,
      columns: [
        { key: "professor", label: "Professeur" },
        { key: "level", label: "Niveau" },
        { key: "field", label: "Filière" },
        { key: "model", label: "Modèle" },
        { key: "students", label: "Étudiants", align: "right" as const, numeric: true },
        { key: "groups", label: "Groupes", align: "right" as const, numeric: true },
        { key: "from_collections", label: "Part des encaissements", align: "right" as const, numeric: true },
        { key: "fixed", label: "Forfait", align: "right" as const, numeric: true },
        { key: "earned", label: "Acquis", align: "right" as const, numeric: true },
        { key: "paid", label: "Versé", align: "right" as const, numeric: true },
        { key: "balance", label: "Solde", align: "right" as const, numeric: true },
        { key: "status", label: "Statut" },
      ],
      rows: data,
      totals: {
        professor: `${data.length} professeurs`,
        earned: toAmount(round2(earnedTotal)),
        paid: toAmount(round2(paidTotal)),
        balance: toAmount(round2(balanceTotal)),
      },
      footnotes: [
        "Les parts en pourcentage sont les montants répartis lors de l'encaissement, pas un recalcul aux taux actuels.",
        "Les éléments de salaire fixe et par étudiant sont évalués sur l'effectif actuel du professeur.",
      ],
    };
  }

  /** The academy's own revenue over time, net of payroll. */
  private async schoolRevenue(academic: AcademicFilter, range: DateRange, query: ReportQueryDto) {
    const series = await this.analytics.profitSeries(query);

    let revenueTotal = ZERO;
    let schoolTotal = ZERO;
    let payrollTotal = ZERO;
    let profitTotal = ZERO;

    const data = series.points.map((point) => {
      revenueTotal = revenueTotal.plus(money(point.revenue));
      schoolTotal = schoolTotal.plus(money(point.school_share));
      payrollTotal = payrollTotal.plus(money(point.payroll_paid));
      profitTotal = profitTotal.plus(money(point.profit));
      return {
        period: point.bucket,
        revenue: point.revenue,
        school_share: point.school_share,
        payroll_paid: point.payroll_paid,
        profit: point.profit,
      };
    });

    return {
      title: "Revenu école",
      columns: [
        { key: "period", label: "Période" },
        { key: "revenue", label: "Encaissé", align: "right" as const, numeric: true },
        { key: "school_share", label: "Part académie", align: "right" as const, numeric: true },
        { key: "payroll_paid", label: "Paie versée", align: "right" as const, numeric: true },
        { key: "profit", label: "Net", align: "right" as const, numeric: true },
      ],
      rows: data,
      totals: {
        period: `${data.length} périodes`,
        revenue: toAmount(round2(revenueTotal)),
        school_share: toAmount(round2(schoolTotal)),
        payroll_paid: toAmount(round2(payrollTotal)),
        profit: toAmount(round2(profitTotal)),
      },
      footnotes: [
        "La paie est comptée au moment du versement, pas à celui de son acquisition.",
        "Le net est la part de l'académie moins la paie réellement versée dans la même période ; un mois qui solde les salaires du mois précédent sera donc plus bas.",
      ],
    };
  }

  private async revenueByDimension(dimension: "level" | "professor" | "group", query: ReportQueryDto) {
    const rows = await this.analytics.breakdown(dimension, { ...query, limit: 500 });

    let revenueTotal = ZERO;
    let schoolTotal = ZERO;
    let professorTotal = ZERO;

    const data = rows.map((row) => {
      revenueTotal = revenueTotal.plus(money(row.revenue));
      schoolTotal = schoolTotal.plus(money(row.school_share));
      professorTotal = professorTotal.plus(money(row.professor_share));
      return {
        name: row.name,
        revenue: row.revenue,
        school_share: row.school_share,
        professor_share: row.professor_share,
        transactions: row.transactions,
      };
    });

    const DIMENSION_LABELS: Record<string, { singular: string; plural: string }> = {
      level: { singular: "Niveau", plural: "niveaux" },
      professor: { singular: "Professeur", plural: "professeurs" },
      group: { singular: "Groupe", plural: "groupes" },
    };
    const labels = DIMENSION_LABELS[dimension] ?? { singular: dimension, plural: dimension };

    return {
      title: `Revenus par ${labels.singular.toLowerCase()}`,
      columns: [
        { key: "name", label: labels.singular },
        { key: "revenue", label: "Encaissé", align: "right" as const, numeric: true },
        { key: "school_share", label: "Part académie", align: "right" as const, numeric: true },
        { key: "professor_share", label: "Part professeur", align: "right" as const, numeric: true },
        { key: "transactions", label: "Transactions", align: "right" as const, numeric: true },
      ],
      rows: data,
      totals: {
        name: `${data.length} ${labels.plural}`,
        revenue: toAmount(round2(revenueTotal)),
        school_share: toAmount(round2(schoolTotal)),
        professor_share: toAmount(round2(professorTotal)),
      },
      footnotes: [],
    };
  }

  /**
   * What the coming months should bring in.
   *
   * Deliberately simple and stated as such: the recurring fees of currently
   * active students, discounted by the collection rate actually achieved over
   * the window. It is a projection of the existing roster, not a growth model,
   * and the footnotes say so rather than letting a reader mistake it for one.
   */
  private async forecast(academic: AcademicFilter, range: DateRange) {
    // Projected billing is the sum of every active enrollment's fee, since each
    // enrollment raises its own invoice each month.
    const [enrollmentAgg, studentCount, historic] = await Promise.all([
      this.db.client
        .select({ sum_fee: sql<string | null>`sum(${studentAssignments.fee})` })
        .from(studentAssignments)
        .innerJoin(students, eq(studentAssignments.student_id, students.id))
        .where(and(eq(students.status, "active"), studentWhere(academic)))
        .then((r) => r[0]),
      this.db.client
        .select({ c: sql<number>`count(*)::int` })
        .from(students)
        .where(and(eq(students.status, "active"), studentWhere(academic)))
        .then((r) => r[0].c),
      this.db.client
        .select({
          sum_amount_due: sql<string | null>`sum(${studentPayments.amount_due})`,
          sum_paid_amount: sql<string | null>`sum(${studentPayments.paid_amount})`,
        })
        .from(studentPayments)
        .where(
          and(
            paymentWhere(academic),
            gte(studentPayments.due_date, range.from),
            lte(studentPayments.due_date, range.to),
            ne(studentPayments.status, "cancelled"),
          ),
        )
        .then((r) => r[0]),
    ]);

    const monthlyBilling = round2(money(enrollmentAgg.sum_fee));
    const rate = ratePercent(
      round2(money(historic.sum_paid_amount)),
      round2(money(historic.sum_amount_due)),
    );
    const factor = money(rate).dividedBy(100);

    const now = new Date();
    const data = Array.from({ length: 6 }, (_, offset) => {
      const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
      const expected = monthlyBilling;
      const projected = round2(expected.times(factor));
      return {
        period: periodOfDate(target),
        active_students: studentCount,
        expected_billing: toAmount(expected),
        projected_collection: toAmount(projected),
        assumed_rate: `${rate}%`,
      };
    });

    return {
      title: "Prévision de revenus",
      columns: [
        { key: "period", label: "Période" },
        { key: "active_students", label: "Étudiants actifs", align: "right" as const, numeric: true },
        { key: "expected_billing", label: "Facturation prévue", align: "right" as const, numeric: true },
        { key: "projected_collection", label: "Encaissement prévu", align: "right" as const, numeric: true },
        { key: "assumed_rate", label: "Taux estimé", align: "right" as const },
      ],
      rows: data,
      totals: {
        period: "6 mois",
        expected_billing: toAmount(round2(monthlyBilling.times(6))),
        projected_collection: toAmount(round2(monthlyBilling.times(6).times(factor))),
      },
      footnotes: [
        "Une projection de l'effectif actuel, pas un modèle de croissance : elle suppose que les étudiants actifs continuent de payer les frais actuels.",
        `Le taux de recouvrement de ${rate}% est celui réellement atteint sur la période sélectionnée.`,
        "Les inscriptions, les départs et les changements de frais ne sont pas modélisés.",
      ],
    };
  }
}
