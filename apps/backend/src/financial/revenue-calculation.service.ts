import { Injectable, Logger } from "@nestjs/common";
import { CompensationModel, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { FinancialSettingsService } from "./financial-settings.service";
import { Money, ZERO, money, percentOf, round2, toAmount } from "./money.util";
import { FormulaScope, evaluateFormula } from "./formula.util";

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
  snapshot: Prisma.InputJsonValue;
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
 */
@Injectable()
export class RevenueCalculationService {
  private readonly logger = new Logger(RevenueCalculationService.name);

  constructor(
    private readonly prisma: PrismaService,
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

    const override = await this.prisma.professor_compensations.findUnique({
      where: { prof_id: profId },
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
      } satisfies Record<string, unknown> as Prisma.InputJsonValue,
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
      students: new Prisma.Decimal(input.studentCount ?? 0),
      groups: new Prisma.Decimal(input.groupCount ?? 0),
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
   * Percentage and hybrid arrangements read their collections element straight
   * off the ledger — those figures were fixed at collection time and are not
   * recomputed here, so past months stay stable when a rate changes. The fixed
   * element is evaluated against the professor's current roster, since a salary
   * is a statement about the arrangement rather than about any one payment.
   */
  async periodEntitlement(profId: string, period: string): Promise<PeriodEntitlement> {
    const [rule, counts, collected] = await Promise.all([
      this.ruleFor(profId),
      this.rosterCounts(profId),
      this.collectedSharesFor(profId, period),
    ]);

    const fixedComponent = this.fixedComponentFor(rule, counts);

    return {
      profId,
      period,
      model: rule.model,
      fromCollections: collected,
      fixedComponent,
      total: round2(collected.plus(fixedComponent)),
      studentCount: counts.studentCount,
      groupCount: counts.groupCount,
    };
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
      this.prisma.groups.count({ where: { prof_id: profId, is_active: true } }),
      // Enrollments, not students: a student in two of this professor's groups
      // occupies two roster seats and is counted for each.
      this.prisma.student_assignments.count({
        where: { student: { status: "active" }, group: { prof_id: profId, is_active: true } },
      }),
    ]);
    return { groupCount, studentCount };
  }

  /** Net professor share on the ledger for a period — refunds already netted off. */
  private async collectedSharesFor(profId: string, period: string): Promise<Money> {
    const agg = await this.prisma.payment_transactions.aggregate({
      where: { prof_id: profId, period },
      _sum: { professor_share: true },
    });
    return round2(money(agg._sum.professor_share));
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
      this.prisma.payment_transactions.groupBy({
        by: ["prof_id"],
        where: { prof_id: { in: profIds }, period },
        _sum: { professor_share: true },
      }),
      this.prisma.groups.groupBy({
        by: ["prof_id"],
        where: { prof_id: { in: profIds }, is_active: true },
        _count: { _all: true },
      }),
      // One row per active enrollment under any of these professors.
      this.prisma.student_assignments.findMany({
        where: { student: { status: "active" }, group: { prof_id: { in: profIds }, is_active: true } },
        select: { group: { select: { prof_id: true } } },
      }),
      this.prisma.professor_compensations.findMany({ where: { prof_id: { in: profIds } } }),
      this.settings.get(),
    ]);

    const studentsByProf = new Map<string, number>();
    for (const row of enrollments) {
      const owner = row.group?.prof_id;
      if (!owner) continue;
      studentsByProf.set(owner, (studentsByProf.get(owner) ?? 0) + 1);
    }

    const sharesByProf = new Map(
      shares.filter((s) => s.prof_id).map((s) => [s.prof_id as string, money(s._sum.professor_share)]),
    );
    const groupsByProf = new Map(
      groupCounts.filter((g) => g.prof_id).map((g) => [g.prof_id as string, g._count._all]),
    );
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
      const fromCollections = round2(sharesByProf.get(profId) ?? ZERO);
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
