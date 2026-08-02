import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { PayrollStatus } from "@iq/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { RevenueCalculationService } from "./revenue-calculation.service";
import { ReceiptNumberService } from "./receipt-number.service";
import { PayrollDocumentService } from "./payroll-document.service";
import { Money, ZERO, money, round2, toAmount } from "./money.util";
import { professorWhere } from "./financial.filters";
import { periodOfDate } from "./period.util";
import type { PayrollQueryDto, RecordPayrollDto, UpdatePayrollDto, UpsertCompensationDto } from "./dto/payroll.dto";
import { validateFormula } from "./formula.util";

/**
 * What a professor has earned, what they have been handed, and the difference.
 *
 * Neither figure is stored as a status. Earnings come from the revenue engine
 * (summing the shares snapshotted on the ledger, plus any salary element), and
 * payments come from `payroll_payments`. Unpaid / partial / paid is the
 * comparison of the two, computed on read — so a late collection that raises
 * what a professor is owed cannot leave a stale "paid" flag behind it.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly revenue: RevenueCalculationService,
    private readonly receipts: ReceiptNumberService,
    private readonly documents: PayrollDocumentService,
  ) {}

  /**
   * The payroll screen: one row per professor for a period, with earnings,
   * payments and balance.
   *
   * Built from four aggregate queries regardless of headcount — the naive shape
   * (a per-professor entitlement call) issues four per professor.
   */
  async list(query: PayrollQueryDto) {
    const period = query.period ?? periodOfDate(new Date());

    const professors = await this.prisma.professors.findMany({
      where: {
        ...professorWhere({ levelId: query.levelId, fieldId: query.fieldId }),
        ...(query.search?.trim()
          ? { full_name: { contains: query.search.trim(), mode: "insensitive" } }
          : {}),
      },
      include: { field: { include: { level: true } } },
      orderBy: { full_name: "asc" },
    });

    if (professors.length === 0) return { data: [], meta: { period, total: 0 } };

    const profIds = professors.map((p) => p.id);
    const [entitlements, paidByProf] = await Promise.all([
      this.revenue.periodEntitlements(profIds, period),
      this.prisma.payroll_payments.groupBy({
        by: ["prof_id"],
        where: { prof_id: { in: profIds }, period },
        _sum: { amount: true },
      }),
    ]);

    const paidMap = new Map(paidByProf.map((p) => [p.prof_id, money(p._sum.amount)]));

    const rows = professors.map((professor) => {
      const entitlement = entitlements.get(professor.id);
      const earned = entitlement ? entitlement.total : ZERO;
      const paid = round2(paidMap.get(professor.id) ?? ZERO);
      const balance = round2(earned.minus(paid));

      return {
        professor: {
          id: professor.id,
          full_name: professor.full_name,
          phone: professor.phone,
          email: professor.email,
          is_active: professor.is_active,
          field: professor.field ? { id: professor.field.id, name: professor.field.name } : null,
          level: professor.field?.level
            ? { id: professor.field.level.id, name: professor.field.level.name }
            : null,
        },
        period,
        model: entitlement?.model ?? "percentage",
        student_count: entitlement?.studentCount ?? 0,
        group_count: entitlement?.groupCount ?? 0,
        earned_from_collections: toAmount(entitlement?.fromCollections ?? ZERO),
        earned_fixed: toAmount(entitlement?.fixedComponent ?? ZERO),
        total_earned: toAmount(earned),
        already_paid: toAmount(paid),
        remaining_balance: toAmount(balance),
        status: this.statusOf(earned, paid),
      };
    });

    const filtered = query.status ? rows.filter((r) => r.status === query.status) : rows;

    return {
      data: filtered,
      meta: {
        period,
        total: filtered.length,
        totals: {
          earned: toAmount(round2(filtered.reduce<Money>((a, r) => a.plus(r.total_earned), ZERO))),
          paid: toAmount(round2(filtered.reduce<Money>((a, r) => a.plus(r.already_paid), ZERO))),
          balance: toAmount(round2(filtered.reduce<Money>((a, r) => a.plus(r.remaining_balance), ZERO))),
        },
      },
    };
  }

  /**
   * Derived, never persisted.
   *
   * A professor owed nothing who has been paid nothing reads as `paid` rather
   * than `unpaid`: there is nothing outstanding, and showing a whole column of
   * "unpaid" for a quiet month would bury the ones that actually need paying.
   */
  private statusOf(earned: Money, paid: Money): PayrollStatus {
    if (paid.greaterThanOrEqualTo(earned)) return "paid";
    if (paid.greaterThan(0)) return "partial";
    return "unpaid";
  }

  /**
   * One professor's full financial page: the arrangement in force, this period's
   * earnings, lifetime totals, teaching load and payout history.
   */
  async detail(profId: string, period?: string) {
    const professor = await this.prisma.professors.findUnique({
      where: { id: profId },
      include: {
        field: { include: { level: true } },
        groups: {
          where: { is_active: true },
          include: {
            _count: {
              select: {
                // Roster per group = active enrollments, not primary-group
                // membership: a student in two of the professor's groups
                // occupies both seats.
                assignments: { where: { student: { status: "active" } } },
              },
            },
          },
        },
        compensation: true,
      },
    });
    if (!professor) throw new NotFoundException(`Professor ${profId} not found`);

    const targetPeriod = period ?? periodOfDate(new Date());

    const [entitlement, rule, lifetimeShares, lifetimePaid, periodPaid, payments, monthly] =
      await Promise.all([
        this.revenue.periodEntitlement(profId, targetPeriod),
        this.revenue.ruleFor(profId),
        this.prisma.payment_transactions.aggregate({
          where: { prof_id: profId },
          _sum: { professor_share: true, amount: true },
        }),
        this.prisma.payroll_payments.aggregate({ where: { prof_id: profId }, _sum: { amount: true } }),
        this.prisma.payroll_payments.aggregate({
          where: { prof_id: profId, period: targetPeriod },
          _sum: { amount: true },
        }),
        this.prisma.payroll_payments.findMany({
          where: { prof_id: profId },
          orderBy: { paid_at: "desc" },
          take: 100,
          include: { recorder: { select: { id: true, full_name: true } } },
        }),
        this.monthlyBreakdown(profId),
      ]);

    const periodEarned = entitlement.total;
    const periodPaidAmount = round2(money(periodPaid._sum.amount));
    const lifetimeEarned = round2(money(lifetimeShares._sum.professor_share));
    const lifetimePaidAmount = round2(money(lifetimePaid._sum.amount));

    return {
      professor: {
        id: professor.id,
        full_name: professor.full_name,
        phone: professor.phone,
        email: professor.email,
        is_active: professor.is_active,
        created_at: professor.created_at,
        field: professor.field ? { id: professor.field.id, name: professor.field.name } : null,
        level: professor.field?.level
          ? { id: professor.field.level.id, name: professor.field.level.name }
          : null,
      },
      compensation: {
        model: rule.model,
        percentage: rule.percentage ? toAmount(rule.percentage) : null,
        fixed_amount: rule.fixedAmount ? toAmount(rule.fixedAmount) : null,
        custom_formula: rule.customFormula,
        is_override: rule.isOverride,
        notes: professor.compensation?.notes ?? null,
      },
      assignments: professor.groups.map((group) => ({
        id: group.id,
        name: group.name,
        capacity: group.capacity,
        schedule_notes: group.schedule_notes,
        student_count: group._count.assignments,
      })),
      student_count: entitlement.studentCount,
      group_count: entitlement.groupCount,
      period: {
        label: targetPeriod,
        // Gross revenue the professor generated, before the split.
        revenue_generated: toAmount(round2(money(await this.periodRevenue(profId, targetPeriod)))),
        earned_from_collections: toAmount(entitlement.fromCollections),
        earned_fixed: toAmount(entitlement.fixedComponent),
        total_earned: toAmount(periodEarned),
        already_paid: toAmount(periodPaidAmount),
        remaining_balance: toAmount(round2(periodEarned.minus(periodPaidAmount))),
        status: this.statusOf(periodEarned, periodPaidAmount),
      },
      lifetime: {
        revenue_generated: toAmount(round2(money(lifetimeShares._sum.amount))),
        total_earned: toAmount(lifetimeEarned),
        already_paid: toAmount(lifetimePaidAmount),
        // Lifetime balance counts only the collections element: a salary is owed
        // per month it applies to, and summing it over "all time" would invent
        // an arrears figure for months the professor was not being paid that way.
        remaining_balance: toAmount(round2(lifetimeEarned.minus(lifetimePaidAmount))),
      },
      monthly_breakdown: monthly,
      payroll_history: payments.map((p) => ({
        ...p,
        amount: toAmount(money(p.amount)),
      })),
    };
  }

  /** Gross collections attributed to a professor in a period, before the split. */
  private async periodRevenue(profId: string, period: string): Promise<Money> {
    const agg = await this.prisma.payment_transactions.aggregate({
      where: { prof_id: profId, period },
      _sum: { amount: true },
    });
    return round2(money(agg._sum.amount));
  }

  /** Twelve months of earned-versus-paid, for the sparkline on the detail page. */
  private async monthlyBreakdown(profId: string) {
    const [shares, payouts] = await Promise.all([
      this.prisma.payment_transactions.groupBy({
        by: ["period"],
        where: { prof_id: profId },
        _sum: { professor_share: true, amount: true },
        orderBy: { period: "desc" },
        take: 12,
      }),
      this.prisma.payroll_payments.groupBy({
        by: ["period"],
        where: { prof_id: profId, period: { not: null } },
        _sum: { amount: true },
      }),
    ]);

    const paidByPeriod = new Map(payouts.map((p) => [p.period as string, money(p._sum.amount)]));

    return shares
      .map((row) => ({
        period: row.period,
        revenue: toAmount(round2(money(row._sum.amount))),
        earned: toAmount(round2(money(row._sum.professor_share))),
        paid: toAmount(round2(paidByPeriod.get(row.period) ?? ZERO)),
      }))
      .reverse();
  }

  // ---------------------------------------------------------------------------
  // Payouts
  // ---------------------------------------------------------------------------

  /**
   * Records money handed to a professor.
   *
   * Overpayment is refused: paying more than is owed is a keying slip, and it
   * would leave a negative balance that reads as the academy being owed money by
   * its staff. A genuine advance can be recorded against the period it covers.
   */
  async recordPayment(profId: string, userId: string, dto: RecordPayrollDto) {
    const professor = await this.prisma.professors.findUnique({ where: { id: profId } });
    if (!professor) throw new NotFoundException(`Professor ${profId} not found`);

    const amount = money(dto.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException("A payroll amount must be greater than zero");
    }

    const period = dto.period ?? periodOfDate(new Date());
    const entitlement = await this.revenue.periodEntitlement(profId, period);
    const alreadyPaid = round2(
      money(
        (
          await this.prisma.payroll_payments.aggregate({
            where: { prof_id: profId, period },
            _sum: { amount: true },
          })
        )._sum.amount,
      ),
    );

    const outstanding = round2(entitlement.total.minus(alreadyPaid));
    if (amount.greaterThan(outstanding)) {
      throw new BadRequestException(
        `That is more than the ${toAmount(outstanding)} outstanding to this professor for ${period}`,
      );
    }

    const paidAt = dto.paid_at ? new Date(dto.paid_at) : new Date();

    const payout = await this.prisma.$transaction(async (tx) => {
      const receiptNumber = await this.receipts.next(tx, "payroll", paidAt);
      const created = await tx.payroll_payments.create({
        data: {
          prof_id: profId,
          period: dto.period ?? period,
          amount: amount.toFixed(2),
          method: "cash",
          receipt_number: receiptNumber,
          paid_at: paidAt,
          notes: dto.notes ?? null,
          recorded_by: userId,
        },
      });
      // The two settlement papers (professor receipt + school report) are minted
      // in the same transaction as the money movement, so a payout that never
      // lands can never leave a document behind it — and the settlement
      // reference number is reserved atomically with the payment.
      await this.documents.generateForPayout(tx, created.id, userId);
      return created;
    });

    await this.audit.record({
      action: "payroll.paid",
      entityType: "payroll_payment",
      entityId: payout.id,
      entityLabel: `${professor.full_name} · ${period} · ${toAmount(amount)}`,
      actorId: userId,
      newValues: {
        amount: toAmount(amount),
        period,
        receipt_number: payout.receipt_number,
      },
      meta: {
        prof_id: profId,
        total_earned: toAmount(entitlement.total),
        already_paid: toAmount(alreadyPaid),
        remaining_after: toAmount(round2(outstanding.minus(amount))),
      },
    });

    return { ...payout, amount: toAmount(money(payout.amount)) };
  }

  /** Corrects a payout that was keyed wrong. Requires a reason when the amount moves. */
  async updatePayment(payoutId: string, userId: string, dto: UpdatePayrollDto) {
    const existing = await this.prisma.payroll_payments.findUnique({
      where: { id: payoutId },
      include: { professor: { select: { full_name: true } } },
    });
    if (!existing) throw new NotFoundException(`Payroll payment ${payoutId} not found`);

    if (dto.amount !== undefined && !dto.reason) {
      throw new BadRequestException("Changing a payroll amount needs a reason");
    }

    const updated = await this.prisma.payroll_payments.update({
      where: { id: payoutId },
      data: {
        ...(dto.amount !== undefined && { amount: money(dto.amount).toFixed(2) }),
        ...(dto.notes !== undefined && { notes: dto.notes || null }),
      },
    });

    await this.audit.record({
      action: "payroll.modified",
      entityType: "payroll_payment",
      entityId: payoutId,
      entityLabel: `${existing.professor.full_name} · ${existing.period ?? "-"}`,
      actorId: userId,
      prevValues: { amount: toAmount(money(existing.amount)), notes: existing.notes },
      newValues: { amount: toAmount(money(updated.amount)), notes: updated.notes },
      meta: { prof_id: existing.prof_id, reason: dto.reason ?? null },
    });

    return { ...updated, amount: toAmount(money(updated.amount)) };
  }

  async removePayment(payoutId: string, userId: string, reason: string) {
    const existing = await this.prisma.payroll_payments.findUnique({
      where: { id: payoutId },
      include: { professor: { select: { full_name: true } } },
    });
    if (!existing) throw new NotFoundException(`Payroll payment ${payoutId} not found`);

    await this.prisma.payroll_payments.delete({ where: { id: payoutId } });

    await this.audit.record({
      action: "payroll.deleted",
      entityType: "payroll_payment",
      entityId: payoutId,
      entityLabel: `${existing.professor.full_name} · ${existing.period ?? "-"}`,
      actorId: userId,
      prevValues: {
        amount: toAmount(money(existing.amount)),
        period: existing.period,
        receipt_number: existing.receipt_number,
      },
      meta: { prof_id: existing.prof_id, reason },
    });
  }

  // ---------------------------------------------------------------------------
  // Per-professor compensation override
  // ---------------------------------------------------------------------------

  async upsertCompensation(profId: string, userId: string, dto: UpsertCompensationDto) {
    const professor = await this.prisma.professors.findUnique({ where: { id: profId } });
    if (!professor) throw new NotFoundException(`Professor ${profId} not found`);

    if (dto.model === "custom") {
      if (!dto.custom_formula) {
        throw new BadRequestException("A custom model needs a formula");
      }
      const check = validateFormula(dto.custom_formula);
      if (!check.valid) throw new BadRequestException(`Invalid formula: ${check.error}`);
    }

    if (
      (dto.model === "fixed_salary" ||
        dto.model === "fixed_per_student" ||
        dto.model === "fixed_per_group" ||
        dto.model === "hybrid") &&
      (dto.fixed_amount === undefined || dto.fixed_amount === null)
    ) {
      throw new BadRequestException(`The ${dto.model} model needs a fixed amount`);
    }

    const existing = await this.prisma.professor_compensations.findUnique({ where: { prof_id: profId } });

    const data = {
      model: dto.model,
      percentage: dto.percentage === undefined ? undefined : dto.percentage,
      fixed_amount: dto.fixed_amount === undefined ? undefined : dto.fixed_amount,
      custom_formula: dto.custom_formula === undefined ? undefined : dto.custom_formula,
      notes: dto.notes ?? null,
    };

    const saved = await this.prisma.professor_compensations.upsert({
      where: { prof_id: profId },
      create: { prof_id: profId, ...data, percentage: dto.percentage ?? null, fixed_amount: dto.fixed_amount ?? null },
      update: data,
    });

    // Changing a split changes what every future collection is worth to this
    // professor — one of the highest-consequence edits in the product.
    await this.audit.record({
      action: "financial.formula_changed",
      entityType: "professor_compensation",
      entityId: saved.id,
      entityLabel: professor.full_name,
      actorId: userId,
      prevValues: existing
        ? {
            model: existing.model,
            percentage: existing.percentage?.toString() ?? null,
            fixed_amount: existing.fixed_amount?.toString() ?? null,
            custom_formula: existing.custom_formula,
          }
        : { model: "academy default" },
      newValues: {
        model: saved.model,
        percentage: saved.percentage?.toString() ?? null,
        fixed_amount: saved.fixed_amount?.toString() ?? null,
        custom_formula: saved.custom_formula,
      },
      meta: { prof_id: profId },
    });

    return saved;
  }

  /** Drops an override so the professor falls back to the academy default. */
  async removeCompensation(profId: string, userId: string) {
    const existing = await this.prisma.professor_compensations.findUnique({
      where: { prof_id: profId },
      include: { professor: { select: { full_name: true } } },
    });
    if (!existing) throw new NotFoundException("This professor has no override to remove");

    await this.prisma.professor_compensations.delete({ where: { prof_id: profId } });

    await this.audit.record({
      action: "financial.formula_changed",
      entityType: "professor_compensation",
      entityId: existing.id,
      entityLabel: existing.professor.full_name,
      actorId: userId,
      prevValues: {
        model: existing.model,
        percentage: existing.percentage?.toString() ?? null,
        fixed_amount: existing.fixed_amount?.toString() ?? null,
      },
      newValues: { model: "academy default" },
      meta: { prof_id: profId, removed: true },
    });
  }
}
