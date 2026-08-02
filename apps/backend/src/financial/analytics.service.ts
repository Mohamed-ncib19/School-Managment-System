import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { FinancialSettingsService } from "./financial-settings.service";
import { Money, ZERO, money, ratePercent, round2, toAmount } from "./money.util";
import { AcademicFilter, paymentWhere, resolveRange, transactionWhere } from "./financial.filters";
import { bucketKey, bucketsInRange, type DateRange, type Granularity } from "./period.util";
import type { Dimension, FinancialQueryDto } from "./dto/analytics.dto";

/** One point on a revenue time series. */
interface SeriesPoint {
  bucket: string;
  revenue: string;
  school_share: string;
  professor_share: string;
  transactions: number;
}

/** One slice of a dimensional breakdown, carrying what a drill-down needs. */
interface BreakdownRow {
  id: string | null;
  name: string;
  revenue: string;
  school_share: string;
  professor_share: string;
  transactions: number;
  /** The dimension a click on this slice should descend into, if any. */
  drill_to: Dimension | null;
  /** The filter to apply when descending. */
  drill_filter: Record<string, string> | null;
}

/** The academic chain, in the order a drill-down walks it. */
const HIERARCHY: Dimension[] = ["level", "field", "professor", "group", "student"];

/**
 * The charts behind Revenue Analytics.
 *
 * Every series is bucketed in Node from a single indexed range scan rather than
 * with one query per bucket: a daily chart over a year is 365 buckets, and a
 * query each would be 365 round trips to draw one line. The scan reads only
 * `paid_at` and the three money columns, all of which are covered by the
 * `paid_at` index.
 *
 * Breakdowns carry their own drill-down target, so the frontend never has to
 * hard-code that a level contains fields — it follows whatever order the active
 * hierarchy configuration declares.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: FinancialSettingsService,
  ) {}

  private academicOf(query: FinancialQueryDto): AcademicFilter {
    return {
      levelId: query.levelId,
      fieldId: query.fieldId,
      profId: query.profId,
      groupId: query.groupId,
      studentId: query.studentId,
    };
  }

  private async rangeOf(query: FinancialQueryDto): Promise<{ range: DateRange; granularity: Granularity }> {
    const settings = await this.settings.get();
    const granularity = query.granularity ?? "monthly";
    return {
      range: resolveRange(query, granularity, settings.academic_year_start_month),
      granularity,
    };
  }

  /**
   * Revenue over time, split into the academy's and the professors' halves.
   *
   * Empty buckets are emitted explicitly — a chart that omits a quiet month
   * draws a straight line across it, which reads as steady income rather than
   * none.
   */
  async revenueSeries(query: FinancialQueryDto): Promise<{ granularity: Granularity; points: SeriesPoint[] }> {
    const { range, granularity } = await this.rangeOf(query);

    const rows = await this.prisma.payment_transactions.findMany({
      where: {
        ...transactionWhere(this.academicOf(query)),
        paid_at: { gte: range.from, lte: range.to },
      },
      select: { paid_at: true, amount: true, school_share: true, professor_share: true },
    });

    const buckets = new Map<string, { revenue: Money; school: Money; professor: Money; count: number }>();
    for (const key of bucketsInRange(range, granularity)) {
      buckets.set(key, { revenue: ZERO, school: ZERO, professor: ZERO, count: 0 });
    }

    for (const row of rows) {
      const key = bucketKey(row.paid_at, granularity);
      const bucket = buckets.get(key) ?? { revenue: ZERO, school: ZERO, professor: ZERO, count: 0 };
      bucket.revenue = bucket.revenue.plus(money(row.amount));
      bucket.school = bucket.school.plus(money(row.school_share));
      bucket.professor = bucket.professor.plus(money(row.professor_share));
      bucket.count += 1;
      buckets.set(key, bucket);
    }

    const points = [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([bucket, value]) => ({
        bucket,
        revenue: toAmount(round2(value.revenue)),
        school_share: toAmount(round2(value.school)),
        professor_share: toAmount(round2(value.professor)),
        transactions: value.count,
      }));

    return { granularity, points };
  }

  /**
   * Profit over time: what the academy kept, against what it paid out in wages.
   *
   * Payroll is bucketed by when it was actually handed over, not by the period
   * it settles, so the trend shows cash as it left the drawer.
   */
  async profitSeries(query: FinancialQueryDto) {
    const { range, granularity } = await this.rangeOf(query);
    const academic = this.academicOf(query);

    const [revenue, payouts] = await Promise.all([
      this.revenueSeries(query),
      this.prisma.payroll_payments.findMany({
        where: {
          ...(academic.profId ? { prof_id: academic.profId } : {}),
          paid_at: { gte: range.from, lte: range.to },
        },
        select: { paid_at: true, amount: true },
      }),
    ]);

    const payrollByBucket = new Map<string, Money>();
    for (const row of payouts) {
      const key = bucketKey(row.paid_at, granularity);
      payrollByBucket.set(key, (payrollByBucket.get(key) ?? ZERO).plus(money(row.amount)));
    }

    return {
      granularity,
      points: revenue.points.map((point) => {
        const payroll = round2(payrollByBucket.get(point.bucket) ?? ZERO);
        const school = money(point.school_share);
        return {
          bucket: point.bucket,
          revenue: point.revenue,
          school_share: point.school_share,
          payroll_paid: toAmount(payroll),
          profit: toAmount(round2(school.minus(payroll))),
        };
      }),
    };
  }

  /**
   * Revenue grouped by one academic dimension.
   *
   * The grouping is done with a single `groupBy` on the ledger keyed by whatever
   * the dimension resolves to, then names are attached in one further query —
   * never a name lookup per row.
   */
  async breakdown(dimension: Dimension, query: FinancialQueryDto): Promise<BreakdownRow[]> {
    const { range } = await this.rangeOf(query);
    const academic = this.academicOf(query);
    const limit = query.limit ?? 20;

    const where: Prisma.payment_transactionsWhereInput = {
      ...transactionWhere(academic),
      paid_at: { gte: range.from, lte: range.to },
    };

    // Professor is the one dimension the ledger stores directly.
    if (dimension === "professor") {
      const grouped = await this.prisma.payment_transactions.groupBy({
        by: ["prof_id"],
        where,
        _sum: { amount: true, school_share: true, professor_share: true },
        _count: { _all: true },
      });

      const ids = grouped.map((g) => g.prof_id).filter((id): id is string => Boolean(id));
      const professors = await this.prisma.professors.findMany({
        where: { id: { in: ids } },
        select: { id: true, full_name: true },
      });
      const names = new Map(professors.map((p) => [p.id, p.full_name]));

      return this.rank(
        grouped.map((g) => ({
          id: g.prof_id,
          name: g.prof_id ? (names.get(g.prof_id) ?? "Unknown") : "Unassigned",
          revenue: money(g._sum.amount),
          school: money(g._sum.school_share),
          professor: money(g._sum.professor_share),
          count: g._count._all,
          drill: this.drillTarget("professor"),
          filter: g.prof_id ? { profId: g.prof_id } : null,
        })),
        limit,
      );
    }

    // Everything else needs the academic chain, so the rows come back with their
    // hierarchy attached and are folded in memory. The ledger is already scoped
    // to a date range, which keeps this bounded. The chain is the invoice's
    // own enrollment — the group a collection was billed under — not the
    // student's primary group.
    const rows = await this.prisma.payment_transactions.findMany({
      where,
      select: {
        amount: true,
        school_share: true,
        professor_share: true,
        payment: {
          select: {
            student: {
              select: { id: true, first_name: true, last_name: true },
            },
            group: {
              select: {
                id: true,
                name: true,
                professor: {
                  select: {
                    id: true,
                    full_name: true,
                    field: {
                      select: { id: true, name: true, level: { select: { id: true, name: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const buckets = new Map<
      string,
      { id: string | null; name: string; revenue: Money; school: Money; professor: Money; count: number }
    >();

    for (const row of rows) {
      const student = row.payment?.student;
      const group = row.payment?.group;
      const professor = group?.professor;
      const field = professor?.field;
      const level = field?.level;

      let id: string | null = null;
      let name = "Unassigned";

      switch (dimension) {
        case "level":
          id = level?.id ?? null;
          name = level?.name ?? "Unassigned";
          break;
        case "field":
          id = field?.id ?? null;
          name = field?.name ?? "Unassigned";
          break;
        case "group":
          id = group?.id ?? null;
          name = group?.name ?? "Unassigned";
          break;
        case "student":
          id = student?.id ?? null;
          name = student ? `${student.first_name} ${student.last_name}` : "Unassigned";
          break;
      }

      const key = id ?? `unassigned:${dimension}`;
      const bucket = buckets.get(key) ?? {
        id,
        name,
        revenue: ZERO,
        school: ZERO,
        professor: ZERO,
        count: 0,
      };
      bucket.revenue = bucket.revenue.plus(money(row.amount));
      bucket.school = bucket.school.plus(money(row.school_share));
      bucket.professor = bucket.professor.plus(money(row.professor_share));
      bucket.count += 1;
      buckets.set(key, bucket);
    }

    const filterKey: Record<Dimension, string> = {
      level: "levelId",
      field: "fieldId",
      professor: "profId",
      group: "groupId",
      student: "studentId",
    };

    return this.rank(
      [...buckets.values()].map((b) => ({
        ...b,
        drill: this.drillTarget(dimension),
        filter: b.id ? { [filterKey[dimension]]: b.id } : null,
      })),
      limit,
    );
  }

  /**
   * The dimension one level deeper in the hierarchy.
   *
   * Follows the fixed academic chain rather than the configurable navigation
   * order: revenue rolls up through the data model, and a level really does
   * contain fields whatever order the sidebar chooses to present them in.
   */
  private drillTarget(from: Dimension): Dimension | null {
    const index = HIERARCHY.indexOf(from);
    if (index === -1 || index >= HIERARCHY.length - 1) return null;
    return HIERARCHY[index + 1];
  }

  private rank(
    rows: {
      id: string | null;
      name: string;
      revenue: Money;
      school: Money;
      professor: Money;
      count: number;
      drill: Dimension | null;
      filter: Record<string, string> | null;
    }[],
    limit: number,
  ): BreakdownRow[] {
    return rows
      .sort((a, b) => b.revenue.comparedTo(a.revenue))
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        name: row.name,
        revenue: toAmount(round2(row.revenue)),
        school_share: toAmount(round2(row.school)),
        professor_share: toAmount(round2(row.professor)),
        transactions: row.count,
        drill_to: row.drill,
        drill_filter: row.filter,
      }));
  }

  /** How invoices in the window are distributed across statuses. */
  async statusDistribution(query: FinancialQueryDto) {
    const { range } = await this.rangeOf(query);

    const grouped = await this.prisma.student_payments.groupBy({
      by: ["status"],
      where: {
        ...paymentWhere(this.academicOf(query)),
        due_date: { gte: range.from, lte: range.to },
      },
      _sum: { amount_due: true, paid_amount: true },
      _count: { _all: true },
    });

    return grouped.map((row) => ({
      status: row.status,
      count: row._count._all,
      amount_due: toAmount(round2(money(row._sum.amount_due))),
      paid_amount: toAmount(round2(money(row._sum.paid_amount))),
    }));
  }

  /**
   * How late payments are trending: invoices settled after their due date, as a
   * share of those settled at all.
   */
  async latePaymentTrend(query: FinancialQueryDto) {
    const { range, granularity } = await this.rangeOf(query);

    const rows = await this.prisma.student_payments.findMany({
      where: {
        ...paymentWhere(this.academicOf(query)),
        paid_at: { not: null, gte: range.from, lte: range.to },
      },
      select: { paid_at: true, due_date: true, amount_due: true },
    });

    const buckets = new Map<string, { late: number; onTime: number; lateAmount: Money }>();
    for (const key of bucketsInRange(range, granularity)) {
      buckets.set(key, { late: 0, onTime: 0, lateAmount: ZERO });
    }

    for (const row of rows) {
      if (!row.paid_at) continue;
      const key = bucketKey(row.paid_at, granularity);
      const bucket = buckets.get(key) ?? { late: 0, onTime: 0, lateAmount: ZERO };
      if (row.paid_at > row.due_date) {
        bucket.late += 1;
        bucket.lateAmount = bucket.lateAmount.plus(money(row.amount_due));
      } else {
        bucket.onTime += 1;
      }
      buckets.set(key, bucket);
    }

    return {
      granularity,
      points: [...buckets.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([bucket, value]) => ({
          bucket,
          late: value.late,
          on_time: value.onTime,
          late_amount: toAmount(round2(value.lateAmount)),
          late_rate: value.late + value.onTime === 0
            ? 0
            : Math.round((value.late / (value.late + value.onTime)) * 1000) / 10,
        })),
    };
  }

  /**
   * Collection rate over time — what proportion of each bucket's invoices was
   * settled. Bucketed by due date, since the question is about the month that
   * was billed, not the day cash happened to arrive.
   */
  async collectionTrend(query: FinancialQueryDto) {
    const { range, granularity } = await this.rangeOf(query);

    const rows = await this.prisma.student_payments.findMany({
      where: {
        ...paymentWhere(this.academicOf(query)),
        due_date: { gte: range.from, lte: range.to },
        status: { not: "cancelled" },
      },
      select: { due_date: true, amount_due: true, paid_amount: true },
    });

    const buckets = new Map<string, { expected: Money; collected: Money }>();
    for (const key of bucketsInRange(range, granularity)) {
      buckets.set(key, { expected: ZERO, collected: ZERO });
    }

    for (const row of rows) {
      const key = bucketKey(row.due_date, granularity);
      const bucket = buckets.get(key) ?? { expected: ZERO, collected: ZERO };
      bucket.expected = bucket.expected.plus(money(row.amount_due));
      bucket.collected = bucket.collected.plus(money(row.paid_amount));
      buckets.set(key, bucket);
    }

    return {
      granularity,
      points: [...buckets.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([bucket, value]) => ({
          bucket,
          expected: toAmount(round2(value.expected)),
          collected: toAmount(round2(value.collected)),
          rate: ratePercent(value.collected, value.expected),
        })),
    };
  }

  /**
   * Professor performance: revenue generated, earned and paid, per professor.
   *
   * Ranked by revenue generated rather than by earnings, so a professor on a
   * small percentage is not made to look unproductive.
   */
  async professorPerformance(query: FinancialQueryDto) {
    const { range } = await this.rangeOf(query);
    const limit = query.limit ?? 10;

    const grouped = await this.prisma.payment_transactions.groupBy({
      by: ["prof_id"],
      where: {
        ...transactionWhere(this.academicOf(query)),
        paid_at: { gte: range.from, lte: range.to },
      },
      _sum: { amount: true, professor_share: true, school_share: true },
      _count: { _all: true },
    });

    const ids = grouped.map((g) => g.prof_id).filter((id): id is string => Boolean(id));
    if (ids.length === 0) return [];

    const [professors, enrollmentPairs] = await Promise.all([
      this.prisma.professors.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          full_name: true,
          field: { select: { id: true, name: true, level: { select: { id: true, name: true } } } },
        },
      }),
      // One row per active enrollment under any of these professors; a student
      // in two of their groups counts twice, because each enrollment is a
      // roster seat with its own fee.
      this.prisma.student_assignments.findMany({
        where: { student: { status: "active" }, group: { prof_id: { in: ids }, is_active: true } },
        select: { student_id: true, group: { select: { prof_id: true } } },
      }),
    ]);

    const studentsByProf = new Map<string, number>();
    for (const row of enrollmentPairs) {
      const owner = row.group?.prof_id;
      if (!owner) continue;
      studentsByProf.set(owner, (studentsByProf.get(owner) ?? 0) + 1);
    }

    const byId = new Map(professors.map((p) => [p.id, p]));

    return grouped
      .filter((g) => g.prof_id)
      .map((g) => {
        const professor = byId.get(g.prof_id as string);
        return {
          id: g.prof_id as string,
          name: professor?.full_name ?? "Unknown",
          field: professor?.field ? { id: professor.field.id, name: professor.field.name } : null,
          level: professor?.field?.level
            ? { id: professor.field.level.id, name: professor.field.level.name }
            : null,
          revenue_generated: toAmount(round2(money(g._sum.amount))),
          professor_share: toAmount(round2(money(g._sum.professor_share))),
          school_share: toAmount(round2(money(g._sum.school_share))),
          student_count: studentsByProf.get(g.prof_id as string) ?? 0,
          transactions: g._count._all,
        };
      })
      .sort((a, b) => money(b.revenue_generated).comparedTo(money(a.revenue_generated)))
      .slice(0, limit);
  }
}
