import { Injectable, Logger } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { DbService } from "../db/db.service";
import { compensationModel, groups, paymentTransactions, professorCompensations, studentAssignments, students } from "../db/schema";
import { FinancialSettingsService } from "./financial-settings.service";
import { Money, ZERO, money, percentOf, round2, toAmount } from "./money.util";
import { FormulaScope, evaluateFormula } from "./formula.util";

type CompensationModel = (typeof compensationModel.enumValues)[number];

/** The compensation arrangement in force for one professor. */
export interface CompensationRule {
  model: CompensationModel;
  percentage: Money | null;
  fixedAmount: Money | null;
  customFormula: string | null;
  /** False when the professor has no override and the academy default applies. */
  isOverride: boolean;
}

/** Everything the engine needs to price one movement of money. */
export interface SplitInput {
  amount: Money;
  profId: string | null;
  period: string;
  /** Only consulted by the per-student / per-group / custom models. */
  studentCount?: number;
  groupCount?: number;
}

export interface RevenueSplit {
  professorShare: Money;
  schoolShare: Money;
  model: CompensationModel;
  /** Stored verbatim on the transaction so the figure can be explained later. */
  snapshot: Record<string, unknown>;
}

/** What a professor is owed for a period, however their arrangement is shaped. */
export interface PeriodEntitlement {
  profId: string;
  period: string;
  model: CompensationModel;
  /** Sum of the shares apportioned to them by individual collections. */
  fromCollections: Money;
  /** Salary or per-head element that does not depend on collections. */
  fixedComponent: Money;
  total: Money;
  studentCount: number;
  groupCount: number;
}

/**
 * The single place a dinar is ever divided between a professor and the academy.
 *
 * Nothing else in the application — no controller, no report, no React component
 * — is permitted to apply a percentage to a payment. Every dashboard figure,
 * payroll balance, receipt and export ultimately reads a `professor_share` or
 * `school_share` this service produced, which is what makes a change of formula
 * propagate everywhere at once instead of having to be chased through the code.
 *
 * Two entry points, because the two questions are genuinely different:
 *
 *   `splitTransaction` — "this 100 DT just came in; whose is it?" Answered at
 *   the moment of collection and snapshotted onto the ledger row, so a later
 *   change of percentage cannot restate history.
 *
 *   `periodEntitlement` — "what has this professor earned this month?" A salary
 *   is owed whether or not anybody paid, so it cannot be derived by summing
 *   per-transaction splits; the fixed models contribute nothing per transaction
 *   and their whole value appears here instead.
 *
 *   Percentage and hybrid entitlements are priced live: how much was collected
 *   this period comes from the ledger, but the professor's share is computed
 *   with the percentage in force *now*. A change of rate — per-professor or the
 *   academy default — shows on the payroll screen and on new settlement
 *   documents immediately, instead of waiting for future collections. Only
 *   `custom` formulas keep their frozen per-transaction splits (their inputs
 *   are not reproducible later), and the historical monthly breakdown always
 *   reads the snapshots, so closed months stay stable.
 */
@Injectable()
export class RevenueCalculationService {
  private readonly logger = new Logger(RevenueCalculationService.name);

  constructor(
    private readonly db: DbService,
    private readonly settings: FinancialSettingsService,
  ) {}

  /**
   * The arrangement for one professor: their own override if they have one,
   * otherwise the academy default.
   */
  async ruleFor(profId: string | null): Promise<CompensationRule> {
    const settings = await this.settings.get();

    const fallback: CompensationRule = {
      model: settings.default_compensation_model,
      percentage: money(settings.default_professor_percentage),
      fixedAmount: settings.default_fixed_amount ? money(settings.default_fixed_amount) : null,
      customFormula: null,
      isOverride: false,
    };

    if (!profId) return fallback;

    const override = await this.db.client.query.professorCompensations.findFirst({
      where: eq(professorCompensations.prof_id, profId),
    });
    if (!override) return fallback;

    return {
      model: override.model,
      // An override that leaves a field blank inherits that field from the
      // default rather than behaving as zero — a blank percentage must never
      // silently mean "this professor earns nothing".
      percentage: override.percentage !== null ? money(override.percentage) : fallback.percentage,
      fixedAmount: override.fixed_amount !== null ? money(override.fixed_amount) : fallback.fixedAmount,
      customFormula: override.custom_formula,
      isOverride: true,
    };
  }

  /**
   * Divides one movement of money.
   *
   * `schoolShare` is always the remainder by subtraction, never a second
   * rounding of its own percentage: that is what guarantees the two halves add
   * back to the amount exactly, which the database enforces as a CHECK.
   *
   * Refunds arrive with a negative amount and fall out correctly without a
   * special case — a professor who was credited 60 of a 100 payment is debited
   * 60 of its 100 reversal.
   */
  async splitTransaction(input: SplitInput): Promise<RevenueSplit> {
    const rule = await this.ruleFor(input.profId);
    const amount = money(input.amount);

    const professorShare = await this.professorShareFor(rule, amount, input);
    const bounded = this.clamp(professorShare, amount);
    const schoolShare = amount.minus(bounded);

    return {
      professorShare: bounded,
      schoolShare,
      model: rule.model,
      snapshot: {
        model: rule.model,
        percentage: rule.percentage ? toAmount(rule.percentage) : null,
        fixed_amount: rule.fixedAmount ? toAmount(rule.fixedAmount) : null,
        custom_formula: rule.customFormula,
        is_override: rule.isOverride,
        amount: toAmount(amount),
        professor_share: toAmount(bounded),
        school_share: toAmount(schoolShare),
        student_count: input.studentCount ?? null,
        group_count: input.groupCount ?? null,
        computed_at: new Date().toISOString(),
      } satisfies Record<string, unknown>,
    };
  }

  private async professorShareFor(
    rule: CompensationRule,
    amount: Money,
    input: SplitInput,
  ): Promise<Money> {
    switch (rule.model) {
      case "percentage":
        return percentOf(amount, rule.percentage ?? ZERO);

      // A salary or a per-head rate is owed regardless of who paid this month,
      // so no part of an individual collection belongs to the professor. The
      // whole amount is the academy's here, and the professor's entitlement is
      // recognised once per period by `periodEntitlement`. Splitting it across
      // arbitrary transactions instead would make a professor's earnings depend
      // on how many instalments their students happened to pay in.
      case "fixed_salary":
      case "fixed_per_student":
      case "fixed_per_group":
        return ZERO;

      // Only the percentage leg is attributable to a transaction; the fixed leg
      // is added per period, exactly as for the pure fixed models.
      case "hybrid":
        return percentOf(amount, rule.percentage ?? ZERO);

      case "custom":
        return this.evaluateCustom(rule, amount, input);

      default:
        return ZERO;
    }
  }

  private evaluateCustom(rule: CompensationRule, amount: Money, input: SplitInput): Money {
    if (!rule.customFormula) return ZERO;

    const scope: FormulaScope = {
      amount,
      percentage: rule.percentage ?? ZERO,
      fixed: rule.fixedAmount ?? ZERO,
      students: new Decimal(input.studentCount ?? 0),
      groups: new Decimal(input.groupCount ?? 0),
    };

    try {
      return round2(evaluateFormula(rule.customFormula, scope));
    } catch (err) {
      // A broken formula must not block a cash collection at the front desk.
      // The academy keeps the money, the event is logged loudly, and an
      // administrator can correct the formula and re-issue.
      this.logger.error(
        `Custom formula failed for period ${input.period} (prof ${input.profId ?? "-"}): ` +
          `${err instanceof Error ? err.message : String(err)}. Falling back to a zero professor share.`,
      );
      return ZERO;
    }
  }

  /**
   * Keeps a share inside the amount being divided.
   *
   * A custom formula or a percentage above 100 could otherwise hand a professor
   * more than the student paid, leaving the academy with a negative share and
   * breaking the ledger's split invariant. Clamping fails visibly in the
   * reports rather than corrupting the books.
   */
  private clamp(share: Money, amount: Money): Money {
    const rounded = round2(share);
    if (amount.isNegative()) {
      if (rounded.greaterThan(0)) return ZERO;
      return rounded.lessThan(amount) ? amount : rounded;
    }
    if (rounded.isNegative()) return ZERO;
    return rounded.greaterThan(amount) ? amount : rounded;
  }

  /**
   * What one professor earned in one period.
   *
   * Percentage and hybrid arrangements price the *open* period live: the
   * collections element is the current percentage applied to the period's net
   * collections, so an override change reflects on the payroll screen the
   * moment it is saved. Custom rules keep their frozen per-transaction splits,
   * and closed months (the monthly breakdown) always read the ledger snapshot.
   */
  async periodEntitlement(profId: string, period: string): Promise<PeriodEntitlement> {
    const [rule, counts, collected, net] = await Promise.all([
      this.ruleFor(profId),
      this.rosterCounts(profId),
      this.collectedSharesFor(profId, period),
      this.collectedAmountFor(profId, period),
    ]);

    const fromCollections = this.fromCollectionsFor(rule, net, collected);
    const fixedComponent = this.fixedComponentFor(rule, counts);

    return {
      profId,
      period,
      model: rule.model,
      fromCollections,
      fixedComponent,
      total: round2(fromCollections.plus(fixedComponent)),
      studentCount: counts.studentCount,
      groupCount: counts.groupCount,
    };
  }

  /**
   * Live pricing of one amount under a rule — the same arithmetic the open
   * period entitlements use, exposed for the settlement documents so the
   * split printed on a quittance can never disagree with the payroll screen.
   *
   * Percentage and hybrid are priced with the rule in force now. The frozen
   * ledger splits stay authoritative for `custom` formulas, whose inputs
   * (student count, formula internals) are not reproducible later; the
   * pure-fixed models have no per-transaction element at all.
   */
  shareFor(rule: CompensationRule, amount: Money): Money {
    switch (rule.model) {
      case "percentage":
      case "hybrid":
        return round2(this.clamp(percentOf(amount, rule.percentage ?? ZERO), amount));
      default:
        return ZERO;
    }
  }

  /**
   * The collections element of an entitlement.
   *
   * Percentage and hybrid read the ledger only for how much was collected;
   * the professor's share is priced with the rule in force now. `custom` falls
   * back to the shares snapshotted at collection time, and the pure-fixed
   * models contribute nothing per transaction.
   */
  private fromCollectionsFor(rule: CompensationRule, net: Money, snapshot: Money): Money {
    switch (rule.model) {
      case "percentage":
      case "hybrid":
        return this.shareFor(rule, net);
      case "custom":
        return snapshot;
      default:
        return ZERO;
    }
  }

  /** Net collections attributed to a professor in a period — refunds netted off. */
  private async collectedAmountFor(profId: string, period: string): Promise<Money> {
    const [row] = await this.db.client
      .select({ sum_amount: sql<string | null>`sum(${paymentTransactions.amount})` })
      .from(paymentTransactions)
      .where(and(eq(paymentTransactions.prof_id, profId), eq(paymentTransactions.period, period)));
    return round2(money(row.sum_amount));
  }

  private fixedComponentFor(
    rule: CompensationRule,
    counts: { studentCount: number; groupCount: number },
  ): Money {
    const fixed = rule.fixedAmount ?? ZERO;

    switch (rule.model) {
      case "fixed_salary":
      case "hybrid":
        return round2(fixed);
      case "fixed_per_student":
        return round2(fixed.times(counts.studentCount));
      case "fixed_per_group":
        return round2(fixed.times(counts.groupCount));
      // `percentage` and `custom` are fully expressed per transaction.
      default:
        return ZERO;
    }
  }

  /** Active students and groups currently taught by a professor. */
  async rosterCounts(profId: string): Promise<{ studentCount: number; groupCount: number }> {
    const [groupCount, studentCount] = await Promise.all([
      this.db.client
        .select({ c: sql<number>`count(*)::int` })
        .from(groups)
        .where(and(eq(groups.prof_id, profId), eq(groups.is_active, true)))
        .then((r) => r[0].c),
      // Enrollments, not students: a student in two of this professor's groups
      // occupies two roster seats and is counted for each.
      this.db.client
        .select({ c: sql<number>`count(*)::int` })
        .from(studentAssignments)
        .innerJoin(students, eq(studentAssignments.student_id, students.id))
        .innerJoin(groups, eq(studentAssignments.group_id, groups.id))
        .where(
          and(eq(students.status, "active"), eq(groups.prof_id, profId), eq(groups.is_active, true)),
        )
        .then((r) => r[0].c),
    ]);
    return { groupCount, studentCount };
  }

  /** Net professor share on the ledger for a period — refunds already netted off. */
  private async collectedSharesFor(profId: string, period: string): Promise<Money> {
    const [row] = await this.db.client
      .select({ sum_share: sql<string | null>`sum(${paymentTransactions.professor_share})` })
      .from(paymentTransactions)
      .where(and(eq(paymentTransactions.prof_id, profId), eq(paymentTransactions.period, period)));
    return round2(money(row.sum_share));
  }

  /**
   * Period entitlements for many professors at once.
   *
   * The payroll screen needs this for every professor in the academy; doing it
   * one `periodEntitlement` call at a time would issue four queries per
   * professor. Here the ledger is aggregated in a single grouped query and the
   * roster counts in two more, regardless of headcount.
   */
  async periodEntitlements(profIds: string[], period: string): Promise<Map<string, PeriodEntitlement>> {
    const result = new Map<string, PeriodEntitlement>();
    if (profIds.length === 0) return result;

    const [shares, groupCounts, enrollments, overrides, settings] = await Promise.all([
      this.db.client
        .select({
          prof_id: paymentTransactions.prof_id,
          sum_professor_share: sql<string | null>`sum(${paymentTransactions.professor_share})`,
          sum_amount: sql<string | null>`sum(${paymentTransactions.amount})`,
        })
        .from(paymentTransactions)
        .where(and(inArray(paymentTransactions.prof_id, profIds), eq(paymentTransactions.period, period)))
        .groupBy(paymentTransactions.prof_id),
      this.db.client
        .select({
          prof_id: groups.prof_id,
          count: sql<number>`count(*)::int`,
        })
        .from(groups)
        .where(and(inArray(groups.prof_id, profIds), eq(groups.is_active, true)))
        .groupBy(groups.prof_id),
      // One row per active enrollment under any of these professors.
      this.db.client
        .select({ prof_id: groups.prof_id })
        .from(studentAssignments)
        .innerJoin(students, eq(studentAssignments.student_id, students.id))
        .innerJoin(groups, eq(studentAssignments.group_id, groups.id))
        .where(
          and(
            eq(students.status, "active"),
            inArray(groups.prof_id, profIds),
            eq(groups.is_active, true),
          ),
        ),
      this.db.client.query.professorCompensations.findMany({
        where: inArray(professorCompensations.prof_id, profIds),
      }),
      this.settings.get(),
    ]);

    const studentsByProf = new Map<string, number>();
    for (const row of enrollments) {
      if (!row.prof_id) continue;
      studentsByProf.set(row.prof_id, (studentsByProf.get(row.prof_id) ?? 0) + 1);
    }

    const sharesByProf = new Map(
      shares.map((s) => [s.prof_id, money(s.sum_professor_share)] as [string, Money]),
    );
    const netByProf = new Map(
      shares.map((s) => [s.prof_id, round2(money(s.sum_amount))] as [string, Money]),
    );
    const groupsByProf = new Map(groupCounts.map((g) => [g.prof_id, g.count]));
    const overrideByProf = new Map(overrides.map((o) => [o.prof_id, o]));

    for (const profId of profIds) {
      const override = overrideByProf.get(profId);
      const rule: CompensationRule = override
        ? {
            model: override.model,
            percentage:
              override.percentage !== null
                ? money(override.percentage)
                : money(settings.default_professor_percentage),
            fixedAmount:
              override.fixed_amount !== null
                ? money(override.fixed_amount)
                : settings.default_fixed_amount
                  ? money(settings.default_fixed_amount)
                  : null,
            customFormula: override.custom_formula,
            isOverride: true,
          }
        : {
            model: settings.default_compensation_model,
            percentage: money(settings.default_professor_percentage),
            fixedAmount: settings.default_fixed_amount ? money(settings.default_fixed_amount) : null,
            customFormula: null,
            isOverride: false,
          };

      const counts = {
        studentCount: studentsByProf.get(profId) ?? 0,
        groupCount: groupsByProf.get(profId) ?? 0,
      };
      const snapshot = round2(sharesByProf.get(profId) ?? ZERO);
      const fromCollections = this.fromCollectionsFor(rule, round2(netByProf.get(profId) ?? ZERO), snapshot);
      const fixedComponent = this.fixedComponentFor(rule, counts);

      result.set(profId, {
        profId,
        period,
        model: rule.model,
        fromCollections,
        fixedComponent,
        total: round2(fromCollections.plus(fixedComponent)),
        studentCount: counts.studentCount,
        groupCount: counts.groupCount,
      });
    }

    return result;
  }

  /**
   * Worked example for the settings screen: what a given rule does to a given
   * amount. Pure — it touches neither the database nor the ledger.
   */
  preview(
    rule: Pick<CompensationRule, "model" | "percentage" | "fixedAmount" | "customFormula">,
    amount: Money,
    counts: { studentCount: number; groupCount: number } = { studentCount: 0, groupCount: 0 },
  ): { professorShare: Money; schoolShare: Money; fixedComponent: Money } {
    const full: CompensationRule = { ...rule, isOverride: true };

    let perTransaction: Money;
    switch (rule.model) {
      case "percentage":
      case "hybrid":
        perTransaction = percentOf(amount, rule.percentage ?? ZERO);
        break;
      case "custom":
        perTransaction = this.evaluateCustom(full, amount, {
          amount,
          profId: null,
          period: "preview",
          studentCount: counts.studentCount,
          groupCount: counts.groupCount,
        });
        break;
      default:
        perTransaction = ZERO;
    }

    const professorShare = this.clamp(perTransaction, amount);
    return {
      professorShare,
      schoolShare: amount.minus(professorShare),
      fixedComponent: this.fixedComponentFor(full, counts),
    };
  }
}
