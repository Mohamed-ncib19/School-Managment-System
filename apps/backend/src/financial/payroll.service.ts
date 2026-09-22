import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { PayrollStatus } from "@iq/shared";
import { and, desc, eq, ilike, inArray, isNotNull, sql, SQL } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { groups, paymentTransactions, payrollPayments, professorCompensations, professors, studentAssignments, studentPayments, students } from "../db/schema";
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
    private readonly db: DbService,
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

    const profRows = await this.db.client.query.professors.findMany({
      where: and(
        professorWhere({ levelId: query.levelId, fieldId: query.fieldId }),
        query.search?.trim() ? ilike(professors.full_name, `%${query.search.trim()}%`) : undefined,
      ),
      with: { field: { with: { level: true } } },
      orderBy: (p, { asc }) => [asc(p.full_name)],
    });

    if (profRows.length === 0) return { data: [], meta: { period, total: 0 } };

    const profIds = profRows.map((p) => p.id);
    const [entitlements, paidByProf] = await Promise.all([
      this.revenue.periodEntitlements(profIds, period),
      this.db.client
        .select({
          prof_id: payrollPayments.prof_id,
          sum_amount: sql<string | null>`sum(${payrollPayments.amount})`,
        })
        .from(payrollPayments)
        .where(and(inArray(payrollPayments.prof_id, profIds), eq(payrollPayments.period, period)))
        .groupBy(payrollPayments.prof_id),
    ]);

    const paidMap = new Map(paidByProf.map((p) => [p.prof_id, money(p.sum_amount)]));

    const rows = profRows.map((professor) => {
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
   * The default status is `unpaid` until an actual payment exists: a professor
   * who has not been handed anything yet — including one who earned nothing
   * this period and so has no solde — stays on the default badge, and only a
   * payment moves the row to `partial` or `paid`.
   */
  private statusOf(earned: Money, paid: Money): PayrollStatus {
    if (paid.lessThanOrEqualTo(0)) return "unpaid";
    if (paid.greaterThanOrEqualTo(earned)) return "paid";
    return "partial";
  }

  /**
   * One professor's full financial page: the arrangement in force, this period's
   * earnings, lifetime totals, teaching load and payout history.
   */
  async detail(profId: string, period?: string) {
    const professor = await this.db.client.query.professors.findFirst({
      where: eq(professors.id, profId),
      with: {
        field: { with: { level: true } },
        // The roster itself is not loaded: the page shows a per-group headcount,
        // and fetching every enrollment with its student attached in order to
        // count the active ones in Node makes this query grow with the
        // professor's whole intake. The counts come from one grouped query
        // below instead.
        groups: { where: (g, { eq }) => eq(g.is_active, true) },
        professorCompensations: {
          columns: { id: true, model: true, percentage: true, fixed_amount: true, custom_formula: true, notes: true },
        },
      },
    });
    if (!professor) throw new NotFoundException(`Professeur ${profId} introuvable`);

    const compensation = professor.professorCompensations[0] ?? null;
    const targetPeriod = period ?? periodOfDate(new Date());

    // `periodRevenue` and `groupBreakdown` join the batch rather than being
    // awaited further down while building the response: as two `await`s inside
    // the returned object literal they ran strictly after everything here had
    // already finished, adding two round trips in series for no reason.
    const [
      entitlement,
      rule,
      lifetimeShares,
      lifetimePaid,
      periodPaid,
      payments,
      monthly,
      periodRevenueAmount,
      groupBreakdown,
      rosterCounts,
      pendingStudents,
    ] = await Promise.all([
      this.revenue.periodEntitlement(profId, targetPeriod),
      this.revenue.ruleFor(profId),
      this.sumProfShares(eq(paymentTransactions.prof_id, profId)),
      this.sumPayouts(eq(payrollPayments.prof_id, profId)),
      this.sumPayouts(and(eq(payrollPayments.prof_id, profId), eq(payrollPayments.period, targetPeriod))),
      this.db.client.query.payrollPayments.findMany({
        where: eq(payrollPayments.prof_id, profId),
        orderBy: (p, { desc }) => [desc(p.paid_at)],
        limit: 100,
        with: { user: { columns: { id: true, full_name: true } } },
      }),
      this.monthlyBreakdown(profId),
      this.periodRevenue(profId, targetPeriod),
      this.groupBreakdown(profId, targetPeriod),
      // Active headcount per group, counted in the database.
      this.db.client
        .select({ group_id: studentAssignments.group_id, count: sql<number>`count(*)::int` })
        .from(studentAssignments)
        .innerJoin(students, eq(studentAssignments.student_id, students.id))
        .innerJoin(groups, eq(studentAssignments.group_id, groups.id))
        .where(and(eq(groups.prof_id, profId), eq(groups.is_active, true), eq(students.status, "active")))
        .groupBy(studentAssignments.group_id),
      this.pendingStudents(profId, targetPeriod),
    ]);

    const studentsByGroup = new Map(rosterCounts.map((r) => [r.group_id, r.count]));

    const periodEarned = entitlement.total;
    const periodPaidAmount = round2(money(periodPaid.sum_amount));
    const lifetimeEarned = round2(money(lifetimeShares.sum_professor_share));
    const lifetimePaidAmount = round2(money(lifetimePaid.sum_amount));

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
        notes: compensation?.notes ?? null,
      },
      assignments: professor.groups.map((group) => ({
        id: group.id,
        name: group.name,
        capacity: group.capacity,
        schedule_notes: group.schedule_notes,
        student_count: studentsByGroup.get(group.id) ?? 0,
      })),
      student_count: entitlement.studentCount,
      group_count: entitlement.groupCount,
      period: {
        label: targetPeriod,
        // Gross revenue the professor generated, before the split.
        revenue_generated: toAmount(round2(money(periodRevenueAmount))),
        earned_from_collections: toAmount(entitlement.fromCollections),
        earned_fixed: toAmount(entitlement.fixedComponent),
        total_earned: toAmount(periodEarned),
        already_paid: toAmount(periodPaidAmount),
        remaining_balance: toAmount(round2(periodEarned.minus(periodPaidAmount))),
        status: this.statusOf(periodEarned, periodPaidAmount),
      },
      lifetime: {
        revenue_generated: toAmount(round2(money(lifetimeShares.sum_amount))),
        total_earned: toAmount(lifetimeEarned),
        already_paid: toAmount(lifetimePaidAmount),
        // Lifetime balance counts only the collections element: a salary is owed
        // per month it applies to, and summing it over "all time" would invent
        // an arrears figure for months the professor was not being paid that way.
        remaining_balance: toAmount(round2(lifetimeEarned.minus(lifetimePaidAmount))),
      },
      monthly_breakdown: monthly,
      group_breakdown: groupBreakdown,
      pending_students: pendingStudents,
      payroll_history: payments.map((p) => {
        const { user, ...rest } = p;
        return { ...rest, recorder: user, amount: toAmount(money(p.amount)) };
      }),
    };
  }

  /** Gross collections attributed to a professor in a period, before the split. */
  private async periodRevenue(profId: string, period: string): Promise<Money> {
    const agg = await this.sumProfShares(
      and(eq(paymentTransactions.prof_id, profId), eq(paymentTransactions.period, period)),
    );
    return round2(money(agg.sum_amount));
  }

  /** Twelve months of earned-versus-paid, for the sparkline on the detail page. */
  private async monthlyBreakdown(profId: string) {
    const [shares, payouts] = await Promise.all([
      this.db.client
        .select({
          period: paymentTransactions.period,
          sum_amount: sql<string | null>`sum(${paymentTransactions.amount})`,
          sum_professor_share: sql<string | null>`sum(${paymentTransactions.professor_share})`,
        })
        .from(paymentTransactions)
        .where(eq(paymentTransactions.prof_id, profId))
        .groupBy(paymentTransactions.period)
        .orderBy(desc(paymentTransactions.period))
        .limit(12),
      this.db.client
        .select({
          period: payrollPayments.period,
          sum_amount: sql<string | null>`sum(${payrollPayments.amount})`,
        })
        .from(payrollPayments)
        .where(and(eq(payrollPayments.prof_id, profId), isNotNull(payrollPayments.period)))
        .groupBy(payrollPayments.period),
    ]);

    const paidByPeriod = new Map(payouts.map((p) => [p.period!, money(p.sum_amount)]));

    return shares
      .map((row) => ({
        period: row.period,
        revenue: toAmount(round2(money(row.sum_amount))),
        earned: toAmount(round2(money(row.sum_professor_share))),
        paid: toAmount(round2(money(paidByPeriod.get(row.period) ?? ZERO))),
      }))
      .reverse();
  }

  /**
   * The students of the period who have not settled yet — itemised, so the
   * professor's page can show exactly whose invoices make up the outstanding
   * amount. The split only applies to money actually collected, so these are
   * projected earnings, never a ledger figure.
   */
  private async pendingStudents(profId: string, period: string) {
    const invoices = await this.db.client
      .select({
        student_id: students.id,
        first_name: students.first_name,
        last_name: students.last_name,
        group_name: groups.name,
        amount_due: studentPayments.amount_due,
        paid_amount: studentPayments.paid_amount,
        status: studentPayments.status,
      })
      .from(studentPayments)
      .innerJoin(groups, eq(studentPayments.group_id, groups.id))
      .innerJoin(students, eq(studentPayments.student_id, students.id))
      .where(and(eq(studentPayments.period, period), eq(groups.prof_id, profId)));

    return invoices
      .filter(
        (i) =>
          i.status !== "paid" &&
          round2(money(i.amount_due).minus(money(i.paid_amount))).greaterThan(0),
      )
      .map((i) => ({
        student_id: i.student_id,
        full_name: `${i.first_name} ${i.last_name}`.trim(),
        group_name: i.group_name,
        amount_due: toAmount(money(i.amount_due)),
        paid_amount: toAmount(money(i.paid_amount)),
        remaining: toAmount(round2(money(i.amount_due).minus(money(i.paid_amount)))),
        status: i.status,
      }))
      .sort(
        (a, b) =>
          a.group_name.localeCompare(b.group_name, "fr") ||
          a.full_name.localeCompare(b.full_name, "fr"),
      );
  }

  /** Per-group breakdown for the professor detail page. */
  async groupBreakdown(profId: string, period: string): Promise<
    { group: string; students: number; revenue: string; professor_share: string; school_share: string }[]
  > {
    const rule = await this.revenue.ruleFor(profId);
    const txns = await this.db.client.query.paymentTransactions.findMany({
      where: and(eq(paymentTransactions.prof_id, profId), eq(paymentTransactions.period, period)),
      with: {
        studentPayment: {
          with: {
            student: { columns: { id: true } },
            group: { columns: { id: true, name: true } },
          },
        },
      },
    });

    const byGroup = new Map<
      string,
      { group: string; students: Set<string>; revenue: Money; professorShare: Money; schoolShare: Money }
    >();

    for (const txn of txns) {
      const key = txn.studentPayment?.group?.id ?? "no-group";
      const name = txn.studentPayment?.group?.name ?? "Sans groupe";
      let row = byGroup.get(key);
      if (!row) {
        row = { group: name, students: new Set(), revenue: ZERO, professorShare: ZERO, schoolShare: ZERO };
        byGroup.set(key, row);
      }
      row.students.add(txn.studentPayment?.student?.id ?? "unknown");
      row.revenue = row.revenue.plus(money(txn.amount));
      row.professorShare = row.professorShare.plus(money(txn.professor_share));
      row.schoolShare = row.schoolShare.plus(money(txn.school_share));
    }

    const liveSplit = rule.model === "percentage" || rule.model === "hybrid";

    return Array.from(byGroup.values())
      .map((row) => {
        let professorShare = round2(row.professorShare);
        let schoolShare = round2(row.schoolShare);
        if (liveSplit) {
          professorShare = this.revenue.shareFor(rule, row.revenue);
          schoolShare = round2(row.revenue.minus(professorShare));
        }
        return {
          group: row.group,
          students: row.students.size,
          revenue: toAmount(round2(row.revenue)),
          professor_share: toAmount(professorShare),
          school_share: toAmount(schoolShare),
        };
      })
      .sort((a, b) => a.group.localeCompare(b.group, "fr"));
  }

  private async sumPayouts(where: SQL | undefined): Promise<{ sum_amount: string | null }> {
    const [row] = await this.db.client
      .select({ sum_amount: sql<string | null>`sum(${payrollPayments.amount})` })
      .from(payrollPayments)
      .where(where);
    return row;
  }

  private async sumProfShares(where: SQL | undefined): Promise<{ sum_amount: string | null; sum_professor_share: string | null }> {
    const [row] = await this.db.client
      .select({
        sum_amount: sql<string | null>`sum(${paymentTransactions.amount})`,
        sum_professor_share: sql<string | null>`sum(${paymentTransactions.professor_share})`,
      })
      .from(paymentTransactions)
      .where(where);
    return row;
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
    const professor = await this.db.client.query.professors.findFirst({
      where: eq(professors.id, profId),
      columns: { full_name: true },
    });
    if (!professor) throw new NotFoundException(`Professeur ${profId} introuvable`);

    const amount = money(dto.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException("Le montant du versement doit être supérieur à zéro");
    }

    const period = dto.period ?? periodOfDate(new Date());
    const entitlement = await this.revenue.periodEntitlement(profId, period);
    const alreadyPaid = round2(
      money(
        await this.sumPayouts(and(eq(payrollPayments.prof_id, profId), eq(payrollPayments.period, period)))
          .then((r) => r.sum_amount),
      ),
    );

    const outstanding = round2(entitlement.total.minus(alreadyPaid));
    if (amount.greaterThan(outstanding)) {
      throw new BadRequestException(
        `C'est plus que le montant de ${toAmount(outstanding)} dû à ce professeur pour ${period}`,
      );
    }

    const paidAt = dto.paid_at ? new Date(dto.paid_at) : new Date();

    const payout = await this.db.client.transaction(async (tx) => {
      const receiptNumber = await this.receipts.next(tx, "payroll", paidAt);
      const [created] = await tx
        .insert(payrollPayments)
        .values({
          prof_id: profId,
          period: dto.period ?? period,
          amount: amount.toFixed(2),
          method: "cash",
          receipt_number: receiptNumber,
          paid_at: paidAt,
          notes: dto.notes ?? null,
          recorded_by: userId,
        })
        .returning();
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
    const existing = await this.db.client.query.payrollPayments.findFirst({
      where: eq(payrollPayments.id, payoutId),
      with: { professor: { columns: { full_name: true } } },
    });
    if (!existing) throw new NotFoundException(`Versement ${payoutId} introuvable`);

    if (dto.amount !== undefined && !dto.reason) {
      throw new BadRequestException("Modifier le montant d'un versement nécessite une raison");
    }

    const [updated] = await this.db.client
      .update(payrollPayments)
      .set({
        ...(dto.amount !== undefined && { amount: money(dto.amount).toFixed(2) }),
        ...(dto.notes !== undefined && { notes: dto.notes || null }),
      })
      .where(eq(payrollPayments.id, payoutId))
      .returning();

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
    const existing = await this.db.client.query.payrollPayments.findFirst({
      where: eq(payrollPayments.id, payoutId),
      with: { professor: { columns: { full_name: true } } },
    });
    if (!existing) throw new NotFoundException(`Versement ${payoutId} introuvable`);

    await this.db.client.delete(payrollPayments).where(eq(payrollPayments.id, payoutId));

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
    const professor = await this.db.client.query.professors.findFirst({
      where: eq(professors.id, profId),
      columns: { full_name: true },
    });
    if (!professor) throw new NotFoundException(`Professeur ${profId} introuvable`);

    if (dto.model === "custom") {
      if (!dto.custom_formula) {
        throw new BadRequestException("Un modèle personnalisé nécessite une formule");
      }
      const check = validateFormula(dto.custom_formula);
      if (!check.valid) throw new BadRequestException(`Formule invalide : ${check.error}`);
    }

    if (
      (dto.model === "fixed_salary" ||
        dto.model === "fixed_per_student" ||
        dto.model === "fixed_per_group" ||
        dto.model === "hybrid") &&
      (dto.fixed_amount === undefined || dto.fixed_amount === null)
    ) {
      throw new BadRequestException(`Le modèle ${dto.model} nécessite un montant fixe`);
    }

    const existing = await this.db.client.query.professorCompensations.findFirst({
      where: eq(professorCompensations.prof_id, profId),
    });

    const base = {
      model: dto.model,
      percentage: dto.percentage ?? null,
      fixed_amount: dto.fixed_amount ?? null,
      custom_formula: dto.custom_formula ?? null,
      notes: dto.notes ?? null,
    };

    let saved: typeof existing;
    if (existing) {
      const set: Partial<typeof base> = { ...base };
      if (dto.percentage === undefined) delete set.percentage;
      if (dto.fixed_amount === undefined) delete set.fixed_amount;
      if (dto.custom_formula === undefined) delete set.custom_formula;
      [saved] = await this.db.client
        .update(professorCompensations)
        .set(set)
        .where(eq(professorCompensations.prof_id, profId))
        .returning();
    } else {
      [saved] = await this.db.client
        .insert(professorCompensations)
        .values({ prof_id: profId, ...base })
        .returning();
    }

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
    const existing = await this.db.client.query.professorCompensations.findFirst({
      where: eq(professorCompensations.prof_id, profId),
      with: { professor: { columns: { full_name: true } } },
    });
    if (!existing) throw new NotFoundException("Ce professeur n'a aucun modèle à supprimer");

    await this.db.client.delete(professorCompensations).where(eq(professorCompensations.prof_id, profId));

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