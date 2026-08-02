import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FinancialSettingsService } from "./financial-settings.service";
import { RevenueCalculationService } from "./revenue-calculation.service";
import { AnalyticsService } from "./analytics.service";
import { ZERO, money, ratePercent, round2, toAmount } from "./money.util";
import { AcademicFilter, paymentWhere, professorWhere, resolveRange, studentWhere, transactionWhere } from "./financial.filters";
import { periodOfDate, type DateRange } from "./period.util";
import type { ReportQueryDto, ReportType } from "./dto/analytics.dto";

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
    private readonly prisma: PrismaService,
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
        throw new BadRequestException(`Unknown report type "${type}"`);
    }
  }

  /** Every movement of money in the window, one row per transaction. */
  private async collections(academic: AcademicFilter, range: DateRange) {
    const rows = await this.prisma.payment_transactions.findMany({
      where: { ...transactionWhere(academic), paid_at: { gte: range.from, lte: range.to } },
      orderBy: { paid_at: "asc" },
      include: {
        recorder: { select: { full_name: true } },
        payment: {
          include: {
            student: true,
            group: {
              include: {
                professor: { include: { field: { include: { level: true } } } },
              },
            },
          },
        },
      },
    });

    let total = ZERO;
    let professorTotal = ZERO;
    let schoolTotal = ZERO;

    const data = rows.map((row) => {
      const student = row.payment?.student;
      // The invoice's own group — the enrollment the money was billed under.
      const group = row.payment?.group;
      const professor = group?.professor;
      const field = professor?.field;

      total = total.plus(money(row.amount));
      professorTotal = professorTotal.plus(money(row.professor_share));
      schoolTotal = schoolTotal.plus(money(row.school_share));

      return {
        receipt_number: row.receipt_number,
        paid_at: row.paid_at.toISOString().slice(0, 10),
        type: row.type,
        student: student ? `${student.first_name} ${student.last_name}` : "—",
        level: field?.level?.name ?? "—",
        field: field?.name ?? "—",
        professor: professor?.full_name ?? "—",
        group: group?.name ?? "—",
        period: row.period,
        amount: toAmount(money(row.amount)),
        professor_share: toAmount(money(row.professor_share)),
        school_share: toAmount(money(row.school_share)),
        recorded_by: row.recorder?.full_name ?? "—",
      };
    });

    return {
      title: "Collection report",
      columns: [
        { key: "receipt_number", label: "Receipt" },
        { key: "paid_at", label: "Date" },
        { key: "type", label: "Type" },
        { key: "student", label: "Student" },
        { key: "level", label: "Level" },
        { key: "field", label: "Field" },
        { key: "professor", label: "Professor" },
        { key: "group", label: "Group" },
        { key: "period", label: "Period" },
        { key: "amount", label: "Amount", align: "right" as const, numeric: true },
        { key: "professor_share", label: "Professor", align: "right" as const, numeric: true },
        { key: "school_share", label: "School", align: "right" as const, numeric: true },
        { key: "recorded_by", label: "Recorded by" },
      ],
      rows: data,
      totals: {
        receipt_number: `${data.length} transactions`,
        amount: toAmount(round2(total)),
        professor_share: toAmount(round2(professorTotal)),
        school_share: toAmount(round2(schoolTotal)),
      },
      footnotes: [
        "Refunds appear as negative amounts and are already netted off the totals.",
        "Shares are the figures apportioned when each payment was taken, not a recalculation at today's rates.",
      ],
    };
  }

  /** Everything still owed, oldest first. */
  private async outstanding(academic: AcademicFilter) {
    const rows = await this.prisma.student_payments.findMany({
      where: {
        ...paymentWhere(academic),
        status: { in: ["not_paid", "due_soon", "overdue", "partially_paid"] },
      },
      orderBy: { due_date: "asc" },
      include: {
        student: true,
        group: { include: { professor: { include: { field: { include: { level: true } } } } } },
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
        status: row.status,
        amount_due: toAmount(money(row.amount_due)),
        paid: toAmount(money(row.paid_amount)),
        balance: toAmount(balance),
      };
    });

    return {
      title: "Outstanding payments",
      columns: [
        { key: "student", label: "Student" },
        { key: "phone", label: "Phone" },
        { key: "level", label: "Level" },
        { key: "field", label: "Field" },
        { key: "professor", label: "Professor" },
        { key: "group", label: "Group" },
        { key: "period", label: "Period" },
        { key: "due_date", label: "Due" },
        { key: "days_overdue", label: "Days late", align: "right" as const, numeric: true },
        { key: "status", label: "Status" },
        { key: "amount_due", label: "Due", align: "right" as const, numeric: true },
        { key: "paid", label: "Paid", align: "right" as const, numeric: true },
        { key: "balance", label: "Balance", align: "right" as const, numeric: true },
      ],
      rows: data,
      totals: { student: `${data.length} invoices`, balance: toAmount(round2(total)) },
      footnotes: [
        "Cancelled invoices are excluded — they were voided rather than left unpaid.",
        "Partially paid invoices appear at their remaining balance.",
      ],
    };
  }

  /** What each professor earned and was paid for a period. */
  private async professorPayroll(academic: AcademicFilter, period?: string) {
    const targetPeriod = period ?? periodOfDate(new Date());

    const professors = await this.prisma.professors.findMany({
      where: professorWhere(academic),
      include: { field: { include: { level: true } } },
      orderBy: { full_name: "asc" },
    });

    if (professors.length === 0) {
      return {
        title: `Professor payroll — ${targetPeriod}`,
        columns: [{ key: "professor", label: "Professor" }],
        rows: [],
        totals: null,
        footnotes: [],
      };
    }

    const profIds = professors.map((p) => p.id);
    const [entitlements, payouts] = await Promise.all([
      this.revenue.periodEntitlements(profIds, targetPeriod),
      this.prisma.payroll_payments.groupBy({
        by: ["prof_id"],
        where: { prof_id: { in: profIds }, period: targetPeriod },
        _sum: { amount: true },
      }),
    ]);

    const paidMap = new Map(payouts.map((p) => [p.prof_id, money(p._sum.amount)]));

    let earnedTotal = ZERO;
    let paidTotal = ZERO;
    let balanceTotal = ZERO;

    const data = professors.map((professor) => {
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
        model: entitlement?.model ?? "percentage",
        students: entitlement?.studentCount ?? 0,
        groups: entitlement?.groupCount ?? 0,
        from_collections: toAmount(entitlement?.fromCollections ?? ZERO),
        fixed: toAmount(entitlement?.fixedComponent ?? ZERO),
        earned: toAmount(earned),
        paid: toAmount(paid),
        balance: toAmount(balance),
        status: paid.greaterThanOrEqualTo(earned) ? "paid" : paid.greaterThan(0) ? "partial" : "unpaid",
      };
    });

    return {
      title: `Professor payroll — ${targetPeriod}`,
      columns: [
        { key: "professor", label: "Professor" },
        { key: "level", label: "Level" },
        { key: "field", label: "Field" },
        { key: "model", label: "Model" },
        { key: "students", label: "Students", align: "right" as const, numeric: true },
        { key: "groups", label: "Groups", align: "right" as const, numeric: true },
        { key: "from_collections", label: "From collections", align: "right" as const, numeric: true },
        { key: "fixed", label: "Fixed", align: "right" as const, numeric: true },
        { key: "earned", label: "Earned", align: "right" as const, numeric: true },
        { key: "paid", label: "Paid", align: "right" as const, numeric: true },
        { key: "balance", label: "Balance", align: "right" as const, numeric: true },
        { key: "status", label: "Status" },
      ],
      rows: data,
      totals: {
        professor: `${data.length} professors`,
        earned: toAmount(round2(earnedTotal)),
        paid: toAmount(round2(paidTotal)),
        balance: toAmount(round2(balanceTotal)),
      },
      footnotes: [
        "Percentage earnings are the shares apportioned at collection time, not a recalculation at today's rates.",
        "Salary and per-head elements are evaluated against the professor's current roster.",
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
      title: "School revenue",
      columns: [
        { key: "period", label: "Period" },
        { key: "revenue", label: "Collected", align: "right" as const, numeric: true },
        { key: "school_share", label: "School share", align: "right" as const, numeric: true },
        { key: "payroll_paid", label: "Payroll paid", align: "right" as const, numeric: true },
        { key: "profit", label: "Net", align: "right" as const, numeric: true },
      ],
      rows: data,
      totals: {
        period: `${data.length} periods`,
        revenue: toAmount(round2(revenueTotal)),
        school_share: toAmount(round2(schoolTotal)),
        payroll_paid: toAmount(round2(payrollTotal)),
        profit: toAmount(round2(profitTotal)),
      },
      footnotes: [
        "Payroll is counted when it was handed over, not when it was earned.",
        "Net is the school's share less payroll actually paid in the same bucket, so a month that settles the previous month's wages will show lower.",
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

    const label = dimension.charAt(0).toUpperCase() + dimension.slice(1);

    return {
      title: `Revenue by ${dimension}`,
      columns: [
        { key: "name", label },
        { key: "revenue", label: "Collected", align: "right" as const, numeric: true },
        { key: "school_share", label: "School", align: "right" as const, numeric: true },
        { key: "professor_share", label: "Professor", align: "right" as const, numeric: true },
        { key: "transactions", label: "Transactions", align: "right" as const, numeric: true },
      ],
      rows: data,
      totals: {
        name: `${data.length} ${dimension}s`,
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
    const studentFilter = studentWhere(academic);

    // Projected billing is the sum of every active enrollment's fee, since each
    // enrollment raises its own invoice each month.
    const [enrollmentAgg, studentCount, historic] = await Promise.all([
      this.prisma.student_assignments.aggregate({
        where: { student: { status: "active", ...(studentFilter ? studentFilter : {}) } },
        _sum: { fee: true },
      }),
      this.prisma.students.count({
        where: { status: "active", ...(studentFilter ? studentFilter : {}) },
      }),
      this.prisma.student_payments.aggregate({
        where: {
          ...paymentWhere(academic),
          due_date: { gte: range.from, lte: range.to },
          status: { not: "cancelled" },
        },
        _sum: { amount_due: true, paid_amount: true },
      }),
    ]);

    const monthlyBilling = round2(money(enrollmentAgg._sum.fee));
    const rate = ratePercent(
      round2(money(historic._sum.paid_amount)),
      round2(money(historic._sum.amount_due)),
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
      title: "Revenue forecast",
      columns: [
        { key: "period", label: "Period" },
        { key: "active_students", label: "Active students", align: "right" as const, numeric: true },
        { key: "expected_billing", label: "Expected billing", align: "right" as const, numeric: true },
        { key: "projected_collection", label: "Projected collection", align: "right" as const, numeric: true },
        { key: "assumed_rate", label: "Assumed rate", align: "right" as const },
      ],
      rows: data,
      totals: {
        period: "6 months",
        expected_billing: toAmount(round2(monthlyBilling.times(6))),
        projected_collection: toAmount(round2(monthlyBilling.times(6).times(factor))),
      },
      footnotes: [
        "A projection of the current roster, not a growth model: it assumes today's active students keep paying today's fees.",
        `The collection rate of ${rate}% is what was actually achieved over the selected window.`,
        "Enrolments, withdrawals and fee changes are not modelled.",
      ],
    };
  }
}
