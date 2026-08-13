import { Injectable } from "@nestjs/common";
import { and, eq, gte, inArray, isNotNull, lte, ne, sql, SQL } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { groups, paymentTransactions, payrollPayments, professors, studentAssignments, studentPayments, students } from "../db/schema";
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
    private readonly db: DbService,
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

    /**
     * Bucketed in Node, deliberately.
     *
     * `date_trunc` in SQL would let the database do the folding, but the two do
     * not agree: `paid_at` is `timestamp without time zone`, node-postgres
     * parses it in the host's local zone, and `bucketKey` then reads it with
     * `getUTC*`. On any host that is not on UTC, a collection recorded just
     * after midnight on the 1st falls in a different month for `date_trunc`
     * than it does here — so moving the grouping into SQL would quietly restate
     * the revenue of every month boundary. That is a change to what the figures
     * mean, not to how fast they are produced, and it does not belong in a
     * performance change.
     *
     * The scan is bounded by the date range and covered by the `paid_at` index,
     * and reads only the four columns it sums.
     */
    const rows = await this.db.client
      .select({
        paid_at: paymentTransactions.paid_at,
        amount: paymentTransactions.amount,
        school_share: paymentTransactions.school_share,
        professor_share: paymentTransactions.professor_share,
      })
      .from(paymentTransactions)
      .where(
        and(
          transactionWhere(this.academicOf(query)),
          gte(paymentTransactions.paid_at, range.from),
          lte(paymentTransactions.paid_at, range.to),
        ),
      );

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
      this.db.client
        .select({
          paid_at: payrollPayments.paid_at,
          amount: payrollPayments.amount,
        })
        .from(payrollPayments)
        .where(
          and(
            academic.profId ? eq(payrollPayments.prof_id, academic.profId) : undefined,
            gte(payrollPayments.paid_at, range.from),
            lte(payrollPayments.paid_at, range.to),
          ),
        ),
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

    const where: SQL | undefined = and(
      transactionWhere(academic),
      gte(paymentTransactions.paid_at, range.from),
      lte(paymentTransactions.paid_at, range.to),
    );

    // Professor is the one dimension the ledger stores directly.
    if (dimension === "professor") {
      const grouped = await this.db.client
        .select({
          prof_id: paymentTransactions.prof_id,
          sum_amount: sql<string | null>`sum(${paymentTransactions.amount})`,
          sum_school_share: sql<string | null>`sum(${paymentTransactions.school_share})`,
          sum_professor_share: sql<string | null>`sum(${paymentTransactions.professor_share})`,
          count: sql<number>`count(*)::int`,
        })
        .from(paymentTransactions)
        .where(where)
        .groupBy(paymentTransactions.prof_id);

      const ids = grouped.map((g) => g.prof_id).filter((id): id is string => Boolean(id));
      const profRows = await this.db.client.query.professors.findMany({
        where: inArray(professors.id, ids),
        with: {
          field: {
            columns: { id: true, name: true },
            with: { level: { columns: { id: true, name: true } } },
          },
        },
      });
      const names = new Map(profRows.map((p) => [p.id, p.full_name]));

      return this.rank(
        grouped.map((g) => ({
          id: g.prof_id,
          name: g.prof_id ? (names.get(g.prof_id) ?? "Unknown") : "Unassigned",
          revenue: money(g.sum_amount),
          school: money(g.sum_school_share),
          professor: money(g.sum_professor_share),
          count: g.count,
          drill: this.drillTarget("professor"),
          filter: g.prof_id ? { profId: g.prof_id } : null,
        })),
        limit,
      );
    }

    // Everything else needs the academic chain. The chain is the invoice's own
    // enrollment — the group a collection was billed under — not the student's
    // primary group.
    //
    // Grouped in the database rather than by reading the ledger into Node: the
    // shape this replaces loaded every transaction in the range, each expanded
    // through a four-level nested join, only to add up three columns per row
    // and keep the top twenty. The joins below are the same chain, walked once
    // per group instead of once per transaction.
    const dimensionKey: Record<Exclude<Dimension, "professor">, { id: SQL; name: SQL }> = {
      level: { id: sql`l.id`, name: sql`l.name` },
      field: { id: sql`f.id`, name: sql`f.name` },
      group: { id: sql`g.id`, name: sql`g.name` },
      student: { id: sql`st.id`, name: sql`(st.first_name || ' ' || st.last_name)` },
    };
    const key = dimensionKey[dimension as Exclude<Dimension, "professor">];

    const grouped = await this.db.rawQuery<{
      id: string | null;
      name: string | null;
      sum_amount: string | null;
      sum_school_share: string | null;
      sum_professor_share: string | null;
      count: number;
    }>(sql`
      select ${key.id} as id,
             ${key.name} as name,
             sum(${paymentTransactions.amount}) as sum_amount,
             sum(${paymentTransactions.school_share}) as sum_school_share,
             sum(${paymentTransactions.professor_share}) as sum_professor_share,
             count(*)::int as count
      from ${paymentTransactions}
      join student_payments sp on sp.id = ${paymentTransactions.payment_id}
      left join students st on st.id = sp.student_id
      left join groups g on g.id = sp.group_id
      left join professors p on p.id = g.prof_id
      left join fields f on f.id = p.field_id
      left join levels l on l.id = f.level_id
      ${where ? sql`where ${where}` : sql``}
      group by ${key.id}, ${key.name}
      order by sum(${paymentTransactions.amount}) desc nulls last
      limit ${limit}
    `);

    const filterKey: Record<Dimension, string> = {
      level: "levelId",
      field: "fieldId",
      professor: "profId",
      group: "groupId",
      student: "studentId",
    };

    // Already ordered and limited by the database, so `rank` is not re-applied
    // — it would only re-sort a list of at most `limit` rows.
    return grouped.map((row) => ({
      id: row.id,
      name: row.name ?? "Unassigned",
      revenue: toAmount(round2(money(row.sum_amount))),
      school_share: toAmount(round2(money(row.sum_school_share))),
      professor_share: toAmount(round2(money(row.sum_professor_share))),
      transactions: row.count,
      drill_to: this.drillTarget(dimension),
      drill_filter: row.id ? { [filterKey[dimension]]: row.id } : null,
    }));
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

    const grouped = await this.db.client
      .select({
        status: studentPayments.status,
        sum_amount_due: sql<string | null>`sum(${studentPayments.amount_due})`,
        sum_paid_amount: sql<string | null>`sum(${studentPayments.paid_amount})`,
        count: sql<number>`count(*)::int`,
      })
      .from(studentPayments)
      .where(
        and(
          paymentWhere(this.academicOf(query)),
          gte(studentPayments.due_date, range.from),
          lte(studentPayments.due_date, range.to),
        ),
      )
      .groupBy(studentPayments.status);

    return grouped.map((row) => ({
      status: row.status,
      count: row.count,
      amount_due: toAmount(round2(money(row.sum_amount_due))),
      paid_amount: toAmount(round2(money(row.sum_paid_amount))),
    }));
  }

  /**
   * How late payments are trending: invoices settled after their due date, as a
   * share of those settled at all.
   */
  async latePaymentTrend(query: FinancialQueryDto) {
    const { range, granularity } = await this.rangeOf(query);

    const rows = await this.db.client
      .select({
        paid_at: studentPayments.paid_at,
        due_date: studentPayments.due_date,
        amount_due: studentPayments.amount_due,
      })
      .from(studentPayments)
      .where(
        and(
          paymentWhere(this.academicOf(query)),
          isNotNull(studentPayments.paid_at),
          gte(studentPayments.paid_at, range.from),
          lte(studentPayments.paid_at, range.to),
        ),
      );

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

    const rows = await this.db.client
      .select({
        due_date: studentPayments.due_date,
        amount_due: studentPayments.amount_due,
        paid_amount: studentPayments.paid_amount,
      })
      .from(studentPayments)
      .where(
        and(
          paymentWhere(this.academicOf(query)),
          gte(studentPayments.due_date, range.from),
          lte(studentPayments.due_date, range.to),
          ne(studentPayments.status, "cancelled"),
        ),
      );

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

    const grouped = await this.db.client
      .select({
        prof_id: paymentTransactions.prof_id,
        sum_amount: sql<string | null>`sum(${paymentTransactions.amount})`,
        sum_professor_share: sql<string | null>`sum(${paymentTransactions.professor_share})`,
        sum_school_share: sql<string | null>`sum(${paymentTransactions.school_share})`,
        count: sql<number>`count(*)::int`,
      })
      .from(paymentTransactions)
      .where(
        and(
          transactionWhere(this.academicOf(query)),
          gte(paymentTransactions.paid_at, range.from),
          lte(paymentTransactions.paid_at, range.to),
        ),
      )
      .groupBy(paymentTransactions.prof_id);

    const ids = grouped.map((g) => g.prof_id).filter((id): id is string => Boolean(id));
    if (ids.length === 0) return [];

    const [profRows, enrollmentPairs] = await Promise.all([
      this.db.client.query.professors.findMany({
        where: inArray(professors.id, ids),
        with: {
          field: {
            columns: { id: true, name: true },
            with: { level: { columns: { id: true, name: true } } },
          },
        },
      }),
      // Active enrollments per professor, counted in the database. A student in
      // two of their groups counts twice, because each enrollment is a roster
      // seat with its own fee — which `count(*)` preserves exactly as folding
      // one row per enrollment in Node did.
      this.db.client
        .select({ prof_id: groups.prof_id, count: sql<number>`count(*)::int` })
        .from(studentAssignments)
        .innerJoin(students, eq(studentAssignments.student_id, students.id))
        .innerJoin(groups, eq(studentAssignments.group_id, groups.id))
        .where(
          and(eq(students.status, "active"), inArray(groups.prof_id, ids), eq(groups.is_active, true)),
        )
        .groupBy(groups.prof_id),
    ]);

    const studentsByProf = new Map(enrollmentPairs.map((row) => [row.prof_id, row.count]));

    const byId = new Map(profRows.map((p) => [p.id, p]));

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
          revenue_generated: toAmount(round2(money(g.sum_amount))),
          professor_share: toAmount(round2(money(g.sum_professor_share))),
          school_share: toAmount(round2(money(g.sum_school_share))),
          student_count: studentsByProf.get(g.prof_id as string) ?? 0,
          transactions: g.count,
        };
      })
      .sort((a, b) => money(b.revenue_generated).comparedTo(money(a.revenue_generated)))
      .slice(0, limit);
  }
}
