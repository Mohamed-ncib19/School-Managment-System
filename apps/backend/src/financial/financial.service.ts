import { Injectable, Logger } from "@nestjs/common";
import { and, eq, gte, inArray, lte, ne, sql, SQL } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { payrollPayments, paymentTransactions, professors, studentPayments } from "../db/schema";
import { FinancialSettingsService } from "./financial-settings.service";
import { RevenueCalculationService } from "./revenue-calculation.service";
import { Money, ZERO, money, ratePercent, round2, toAmount } from "./money.util";
import { paymentWhere, professorWhere, resolveRange, transactionWhere, AcademicFilter } from "./financial.filters";
import { periodOfDate } from "./period.util";
import type { FinancialQueryDto } from "./dto/analytics.dto";

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/** How long a dashboard figure may be stale. */
const KPI_TTL_MS = 60_000;

/**
 * The dashboard's headline numbers.
 *
 * Every figure is aggregated in the database — `SUM` and `COUNT` over indexed
 * columns — rather than by reading rows into Node and adding them up.
 *
 * Results are cached for a minute per filter combination. Cash is collected at a
 * desk, not by the second, so a KPI card a minute behind is indistinguishable
 * from a live one; the cache is dropped outright whenever money moves.
 */
@Injectable()
export class FinancialService {
  private readonly logger = new Logger(FinancialService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly db: DbService,
    private readonly settings: FinancialSettingsService,
    private readonly revenue: RevenueCalculationService,
  ) {}

  /**
   * Invalidates every cached figure.
   *
   * Called after any write that could move a number.
   */
  invalidate(): void {
    this.cache.clear();
  }

  private async cached<T>(key: string, produce: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;

    const value = await produce();
    this.cache.set(key, { value, expiresAt: Date.now() + KPI_TTL_MS });

    // Bounded so a wide range of filter combinations cannot grow without limit.
    if (this.cache.size > 200) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }

    return value;
  }

  /**
   * The eight KPI cards.
   *
   * `expected` is what was invoiced in the window, `collected` what the ledger
   * actually received against it, and `collection_rate` the ratio — the single
   * number that says whether the month is going well.
   */
  async dashboard(query: FinancialQueryDto) {
    const settings = await this.settings.get();
    const granularity = query.granularity ?? "monthly";
    const range = resolveRange(query, granularity, settings.academic_year_start_month);
    const key = `kpi:${JSON.stringify({ query, from: range.from, to: range.to })}`;

    return this.cached(key, async () => {
      const academic: AcademicFilter = {
        levelId: query.levelId,
        fieldId: query.fieldId,
        profId: query.profId,
        groupId: query.groupId,
        studentId: query.studentId,
      };

      const invoiceScope = and(
        paymentWhere(academic),
        gte(studentPayments.due_date, range.from),
        lte(studentPayments.due_date, range.to),
        // A voided invoice was never really owed; counting it would depress the
        // collection rate for money nobody was ever going to pay.
        ne(studentPayments.status, "cancelled"),
      );

      const ledgerScope = and(
        transactionWhere(academic),
        gte(paymentTransactions.paid_at, range.from),
        lte(paymentTransactions.paid_at, range.to),
      );

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const currentPeriod = periodOfDate(new Date());

      const [
        invoiced,
        ledger,
        pending,
        overdue,
        thisMonth,
        lifetime,
        payrollDue,
        payrollPaid,
      ] = await Promise.all([
        this.aggregateInvoices(invoiceScope),
        this.aggregateLedger(ledgerScope),
        this.aggregateInvoices(
          and(paymentWhere(academic), inArray(studentPayments.status, ["not_paid", "due_soon", "partially_paid"]), gte(studentPayments.due_date, today)),
        ),
        this.aggregateInvoices(
          and(
            paymentWhere(academic),
            // "Overdue" is a derived view, not a stored state: invoices past
            // their due date are plain not_paid (or partially paid). Count the
            // outstanding balance of every invoice whose due date has passed.
            inArray(studentPayments.status, ["not_paid", "due_soon", "partially_paid"]),
            lte(studentPayments.due_date, today),
          ),
        ),
        this.aggregateLedger(
          and(transactionWhere(academic), eq(paymentTransactions.period, currentPeriod)),
        ),
        this.aggregateLedger(transactionWhere(academic)),
        this.payrollLiability(academic, currentPeriod),
        this.aggregatePayroll(
          and(
            Object.values(academic).some(Boolean) ? professorWhere(academic) : undefined,
            gte(payrollPayments.paid_at, range.from),
            lte(payrollPayments.paid_at, range.to),
          ),
        ),
      ]);

      const expected = round2(money(invoiced.sum_amount_due));
      const collected = round2(money(ledger.sum_amount));
      const schoolShare = round2(money(ledger.sum_school_share));
      const professorShare = round2(money(ledger.sum_professor_share));

      const pendingOutstanding = round2(
        money(pending.sum_amount_due).minus(money(pending.sum_paid_amount)),
      );
      const overdueOutstanding = round2(
        money(overdue.sum_amount_due).minus(money(overdue.sum_paid_amount)),
      );

      return {
        range: { from: range.from, to: range.to, granularity },
        currency: settings.currency,
        cards: {
          total_revenue: {
            value: toAmount(round2(money(lifetime.sum_amount))),
            label: "Total revenue",
          },
          collected_this_month: {
            value: toAmount(round2(money(thisMonth.sum_amount))),
            period: currentPeriod,
          },
          collected_in_range: { value: toAmount(collected), count: ledger.count_all },
          pending_payments: {
            value: toAmount(pendingOutstanding),
            count: pending.count_all,
          },
          overdue_payments: {
            value: toAmount(overdueOutstanding),
            count: overdue.count_all,
          },
          professor_payroll: {
            /** Owed to professors for the current period, net of what they have been handed. */
            value: toAmount(payrollDue.outstanding),
            earned: toAmount(payrollDue.earned),
            paid: toAmount(payrollDue.paid),
            paid_in_range: toAmount(round2(money(payrollPaid.sum_amount))),
          },
          school_net_revenue: {
            /** The academy's share of what was collected in the window. */
            value: toAmount(schoolShare),
            professor_share: toAmount(professorShare),
          },
          expected_revenue: {
            value: toAmount(expected),
            count: invoiced.count_all,
          },
          collection_rate: {
            value: ratePercent(round2(money(invoiced.sum_paid_amount)), expected),
            collected: toAmount(round2(money(invoiced.sum_paid_amount))),
            expected: toAmount(expected),
          },
        },
      };
    });
  }

  private async aggregateInvoices(where: SQL | undefined) {
    const [row] = await this.db.client
      .select({
        sum_amount_due: sql<string | null>`sum(${studentPayments.amount_due})`,
        sum_paid_amount: sql<string | null>`sum(${studentPayments.paid_amount})`,
        count_all: sql<number>`count(*)::int`,
      })
      .from(studentPayments)
      .where(where);
    return row;
  }

  private async aggregateLedger(where: SQL | undefined) {
    const [row] = await this.db.client
      .select({
        sum_amount: sql<string | null>`sum(${paymentTransactions.amount})`,
        sum_professor_share: sql<string | null>`sum(${paymentTransactions.professor_share})`,
        sum_school_share: sql<string | null>`sum(${paymentTransactions.school_share})`,
        count_all: sql<number>`count(*)::int`,
      })
      .from(paymentTransactions)
      .where(where);
    return row;
  }

  private async aggregatePayroll(where: SQL | undefined) {
    const [row] = await this.db.client
      .select({ sum_amount: sql<string | null>`sum(${payrollPayments.amount})` })
      .from(payrollPayments)
      .where(where);
    return row;
  }

  /**
   * What the academy owes its professors for a period.
   *
   * Has to go through the revenue engine rather than summing the ledger: a
   * professor on a salary earns it whether or not a single student paid, and
   * that liability is invisible in `professor_share`.
   */
  private async payrollLiability(
    academic: AcademicFilter,
    period: string,
  ): Promise<{ earned: Money; paid: Money; outstanding: Money }> {
    const profs = await this.db.client.query.professors.findMany({
      where: and(professorWhere(academic), eq(professors.is_active, true)),
      columns: { id: true },
    });
    if (profs.length === 0) return { earned: ZERO, paid: ZERO, outstanding: ZERO };

    const profIds = profs.map((p) => p.id);
    const [entitlements, paid] = await Promise.all([
      this.revenue.periodEntitlements(profIds, period),
      this.aggregatePayroll(and(inArray(payrollPayments.prof_id, profIds), eq(payrollPayments.period, period))),
    ]);

    const earned = round2(
      [...entitlements.values()].reduce<Money>((acc, e) => acc.plus(e.total), ZERO),
    );
    const paidAmount = round2(money(paid.sum_amount));

    return {
      earned,
      paid: paidAmount,
      // Clamped at zero: an overpaid month is a payroll question, not a negative
      // liability on the dashboard.
      outstanding: round2(earned.minus(paidAmount).lessThan(0) ? ZERO : earned.minus(paidAmount)),
    };
  }

  /**
   * A compact summary for the main (non-financial) dashboard, so that page does
   * not have to know how any of this is computed.
   */
  async summary() {
    const settings = await this.settings.get();
    const currentPeriod = periodOfDate(new Date());

    return this.cached(`summary:${currentPeriod}`, async () => {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const [collected, invoiced, overdue] = await Promise.all([
        this.aggregateLedger(eq(paymentTransactions.period, currentPeriod)),
        this.aggregateInvoices(
          and(eq(studentPayments.period, currentPeriod), ne(studentPayments.status, "cancelled")),
        ),
        this.countOverdue(and(inArray(studentPayments.status, ["overdue", "partially_paid"]), lte(studentPayments.due_date, today))),
      ]);

      const expected = round2(money(invoiced.sum_amount_due));
      const paid = round2(money(invoiced.sum_paid_amount));

      return {
        period: currentPeriod,
        currency: settings.currency,
        collected: toAmount(round2(money(collected.sum_amount))),
        school_share: toAmount(round2(money(collected.sum_school_share))),
        expected: toAmount(expected),
        outstanding: toAmount(round2(expected.minus(paid))),
        overdue_count: overdue,
        collection_rate: ratePercent(paid, expected),
      };
    });
  }

  private async countOverdue(where: SQL | undefined): Promise<number> {
    const [row] = await this.db.client
      .select({ count: sql<number>`count(*)::int` })
      .from(studentPayments)
      .where(where);
    return row.count;
  }
}