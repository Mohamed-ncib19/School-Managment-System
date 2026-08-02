import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { FinancialSettingsService } from "./financial-settings.service";
import { RevenueCalculationService } from "./revenue-calculation.service";
import { Money, ZERO, money, ratePercent, round2, toAmount } from "./money.util";
import { paymentWhere, professorWhere, resolveRange, transactionWhere } from "./financial.filters";
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
 * columns — rather than by reading rows into Node and adding them up. The page
 * this replaces fetched every payment in the academy to compute four totals,
 * which is survivable at one student and not at a thousand.
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
    private readonly prisma: PrismaService,
    private readonly settings: FinancialSettingsService,
    private readonly revenue: RevenueCalculationService,
  ) {}

  /**
   * Invalidates every cached figure.
   *
   * Called after any write that could move a number. Coarse on purpose: working
   * out which of the cached filter combinations a single payment affects costs
   * more than recomputing them, and being wrong shows the administrator a stale
   * total.
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
      const academic = {
        levelId: query.levelId,
        fieldId: query.fieldId,
        profId: query.profId,
        groupId: query.groupId,
        studentId: query.studentId,
      };

      const invoiceScope: Prisma.student_paymentsWhereInput = {
        ...paymentWhere(academic),
        due_date: { gte: range.from, lte: range.to },
        // A voided invoice was never really owed; counting it would depress the
        // collection rate for money nobody was ever going to pay.
        status: { not: "cancelled" },
      };

      const ledgerScope: Prisma.payment_transactionsWhereInput = {
        ...transactionWhere(academic),
        paid_at: { gte: range.from, lte: range.to },
      };

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
        this.prisma.student_payments.aggregate({
          where: invoiceScope,
          _sum: { amount_due: true, paid_amount: true },
          _count: { _all: true },
        }),
        this.prisma.payment_transactions.aggregate({
          where: ledgerScope,
          _sum: { amount: true, professor_share: true, school_share: true },
          _count: { _all: true },
        }),
        this.prisma.student_payments.aggregate({
          where: {
            ...paymentWhere(academic),
            status: { in: ["not_paid", "due_soon", "partially_paid"] },
            due_date: { gte: today },
          },
          _sum: { amount_due: true, paid_amount: true },
          _count: { _all: true },
        }),
        this.prisma.student_payments.aggregate({
          where: {
            ...paymentWhere(academic),
            // "Overdue" is a derived view, not a stored state: invoices past
            // their due date are plain not_paid (or partially paid). Count the
            // outstanding balance of every invoice whose due date has passed.
            status: { in: ["not_paid", "due_soon", "partially_paid"] },
            due_date: { lt: today },
          },
          _sum: { amount_due: true, paid_amount: true },
          _count: { _all: true },
        }),
        this.prisma.payment_transactions.aggregate({
          where: { ...transactionWhere(academic), period: currentPeriod },
          _sum: { amount: true },
        }),
        this.prisma.payment_transactions.aggregate({
          where: transactionWhere(academic),
          _sum: { amount: true, school_share: true, professor_share: true },
        }),
        this.payrollLiability(academic, currentPeriod),
        this.prisma.payroll_payments.aggregate({
          where: {
            ...(Object.values(academic).some(Boolean)
              ? { professor: professorWhere(academic) }
              : {}),
            paid_at: { gte: range.from, lte: range.to },
          },
          _sum: { amount: true },
        }),
      ]);

      const expected = round2(money(invoiced._sum.amount_due));
      const collected = round2(money(ledger._sum.amount));
      const schoolShare = round2(money(ledger._sum.school_share));
      const professorShare = round2(money(ledger._sum.professor_share));

      const pendingOutstanding = round2(
        money(pending._sum.amount_due).minus(money(pending._sum.paid_amount)),
      );
      const overdueOutstanding = round2(
        money(overdue._sum.amount_due).minus(money(overdue._sum.paid_amount)),
      );

      return {
        range: { from: range.from, to: range.to, granularity },
        currency: settings.currency,
        cards: {
          total_revenue: {
            value: toAmount(round2(money(lifetime._sum.amount))),
            label: "Total revenue",
          },
          collected_this_month: {
            value: toAmount(round2(money(thisMonth._sum.amount))),
            period: currentPeriod,
          },
          collected_in_range: { value: toAmount(collected), count: ledger._count._all },
          pending_payments: {
            value: toAmount(pendingOutstanding),
            count: pending._count._all,
          },
          overdue_payments: {
            value: toAmount(overdueOutstanding),
            count: overdue._count._all,
          },
          professor_payroll: {
            /** Owed to professors for the current period, net of what they have been handed. */
            value: toAmount(payrollDue.outstanding),
            earned: toAmount(payrollDue.earned),
            paid: toAmount(payrollDue.paid),
            paid_in_range: toAmount(round2(money(payrollPaid._sum.amount))),
          },
          school_net_revenue: {
            /** The academy's share of what was collected in the window. */
            value: toAmount(schoolShare),
            professor_share: toAmount(professorShare),
          },
          expected_revenue: {
            value: toAmount(expected),
            count: invoiced._count._all,
          },
          collection_rate: {
            value: ratePercent(round2(money(invoiced._sum.paid_amount)), expected),
            collected: toAmount(round2(money(invoiced._sum.paid_amount))),
            expected: toAmount(expected),
          },
        },
      };
    });
  }

  /**
   * What the academy owes its professors for a period.
   *
   * Has to go through the revenue engine rather than summing the ledger: a
   * professor on a salary earns it whether or not a single student paid, and
   * that liability is invisible in `professor_share`.
   */
  private async payrollLiability(
    academic: Parameters<typeof professorWhere>[0],
    period: string,
  ): Promise<{ earned: Money; paid: Money; outstanding: Money }> {
    const professors = await this.prisma.professors.findMany({
      where: { ...professorWhere(academic), is_active: true },
      select: { id: true },
    });
    if (professors.length === 0) return { earned: ZERO, paid: ZERO, outstanding: ZERO };

    const profIds = professors.map((p) => p.id);
    const [entitlements, paid] = await Promise.all([
      this.revenue.periodEntitlements(profIds, period),
      this.prisma.payroll_payments.aggregate({
        where: { prof_id: { in: profIds }, period },
        _sum: { amount: true },
      }),
    ]);

    const earned = round2(
      [...entitlements.values()].reduce<Money>((acc, e) => acc.plus(e.total), ZERO),
    );
    const paidAmount = round2(money(paid._sum.amount));

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
        this.prisma.payment_transactions.aggregate({
          where: { period: currentPeriod },
          _sum: { amount: true, school_share: true },
        }),
        this.prisma.student_payments.aggregate({
          where: { period: currentPeriod, status: { not: "cancelled" } },
          _sum: { amount_due: true, paid_amount: true },
        }),
        this.prisma.student_payments.count({
          where: { status: { in: ["overdue", "partially_paid"] }, due_date: { lt: today } },
        }),
      ]);

      const expected = round2(money(invoiced._sum.amount_due));
      const paid = round2(money(invoiced._sum.paid_amount));

      return {
        period: currentPeriod,
        currency: settings.currency,
        collected: toAmount(round2(money(collected._sum.amount))),
        school_share: toAmount(round2(money(collected._sum.school_share))),
        expected: toAmount(expected),
        outstanding: toAmount(round2(expected.minus(paid))),
        overdue_count: overdue,
        collection_rate: ratePercent(paid, expected),
      };
    });
  }
}
