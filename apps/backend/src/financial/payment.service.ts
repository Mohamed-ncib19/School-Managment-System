import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PaymentStatus, Prisma, TransactionType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { RevenueCalculationService } from "./revenue-calculation.service";
import { ReceiptNumberService } from "./receipt-number.service";
import { FinancialSettingsService } from "./financial-settings.service";
import { Money, money, round2, toAmount } from "./money.util";
import { billingPeriods, dueDateFor, periodOf } from "./billing.util";
import { paymentWhere } from "./financial.filters";
import type {
  CancelPaymentDto,
  CorrectTransactionDto,
  PaymentQueryDto,
  RecordTransactionDto,
  RefundTransactionDto,
  UpdatePaymentStatusDto,
} from "./dto/payment.dto";

/** The invoice plus everything the UI needs to render a row without a second call. */
const PAYMENT_INCLUDE = {
  student: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      group: {
        select: {
          id: true,
          name: true,
          color: true,
          prof_id: true,
          professor: {
            select: {
              id: true,
              full_name: true,
              color: true,
              field: {
                select: {
                  id: true,
                  name: true,
                  color: true,
                  level: { select: { id: true, name: true, color: true } },
                },
              },
            },
          },
        },
      },
    },
  },
  group: {
    select: {
      id: true,
      name: true,
      color: true,
      prof_id: true,
      professor: {
        select: {
          id: true,
          full_name: true,
          color: true,
          field: {
            select: {
              id: true,
              name: true,
              color: true,
              level: { select: { id: true, name: true, color: true } },
            },
          },
        },
      },
    },
  },
  transactions: {
    orderBy: { paid_at: "asc" },
    select: {
      id: true,
      type: true,
      amount: true,
      professor_share: true,
      school_share: true,
      receipt_number: true,
      paid_at: true,
      recorder: { select: { id: true, full_name: true } },
    },
  },
} satisfies Prisma.student_paymentsInclude;

/** Full include for detail views - includes assignments for context menus. */
const PAYMENT_INCLUDE_FULL = {
  student: {
    include: {
      group: {
        include: {
          professor: { include: { field: { include: { level: true } } } },
        },
      },
      assignments: {
        include: {
          group: {
            include: {
              professor: { include: { field: { include: { level: true } } } },
            },
          },
        },
      },
    },
  },
  group: {
    include: {
      professor: { include: { field: { include: { level: true } } } },
    },
  },
  transactions: {
    orderBy: { paid_at: "asc" },
    include: { recorder: { select: { id: true, full_name: true } } },
  },
} satisfies Prisma.student_paymentsInclude;

type PaymentWithContext = Prisma.student_paymentsGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

/**
 * Student invoices and the ledger of money moved against them.
 *
 * The invariant this service exists to hold: `student_payments.paid_amount` is
 * always exactly the sum of that invoice's `payment_transactions.amount`, and
 * `status` is always the state that total implies. Both are recomputed from the
 * ledger inside the same transaction as every write, so there is no path — a
 * partial payment, a refund, a correction, a cancellation — that can leave the
 * invoice disagreeing with its own history.
 *
 * Nothing here computes a revenue split. Every transaction's professor/school
 * shares come from RevenueCalculationService and are snapshotted onto the row.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly revenue: RevenueCalculationService,
    private readonly receipts: ReceiptNumberService,
    private readonly settings: FinancialSettingsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------

  /**
   * The student-payments list. Paginated in the database rather than in the
   * page, because a year of collections for a full academy is tens of thousands
   * of rows and the old screen fetched every one of them to count four totals.
   */
  async list(query: PaymentQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where = await this.buildWhere(query);

    const sortBy = query.sortBy ?? "due_date";
    const sortDir = query.sortDir ?? "desc";

    const [rows, total, totals] = await Promise.all([
      this.prisma.student_payments.findMany({
        where,
        include: PAYMENT_INCLUDE,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.student_payments.count({ where }),
      // Totals span the whole filtered set, not just the page on screen —
      // a footer that only adds up the visible rows is actively misleading.
      this.prisma.student_payments.aggregate({
        where,
        _sum: { amount_due: true, paid_amount: true },
      }),
    ]);

    return {
      data: rows.map((row) => this.present(row)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        totals: {
          amount_due: toAmount(money(totals._sum.amount_due)),
          paid_amount: toAmount(money(totals._sum.paid_amount)),
          outstanding: toAmount(
            round2(money(totals._sum.amount_due).minus(money(totals._sum.paid_amount))),
          ),
        },
      },
    };
  }

  private async buildWhere(query: PaymentQueryDto): Promise<Prisma.student_paymentsWhereInput> {
    const where: Prisma.student_paymentsWhereInput = { ...paymentWhere(query) };

    if (query.status) where.status = query.status;
    if (query.period) where.period = query.period;
    if (query.year) where.period = { startsWith: `${query.year}-` };

    if (query.from || query.to) {
      const due: Prisma.DateTimeFilter = {};
      if (query.from) {
        const parsed = new Date(query.from);
        if (!isNaN(parsed.getTime())) due.gte = parsed;
      }
      if (query.to) {
        const parsed = new Date(query.to);
        if (!isNaN(parsed.getTime())) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(query.to)) parsed.setUTCHours(23, 59, 59, 999);
          due.lte = parsed;
        }
      }
      if (due.gte || due.lte) where.due_date = due;
    }

    if (query.receiptNumber) {
      where.transactions = { some: { receipt_number: { contains: query.receiptNumber, mode: "insensitive" } } };
    }

    if (query.method) {
      where.transactions = {
        ...(where.transactions as object),
        some: { ...(where.transactions as any)?.some, method: query.method },
      };
    }

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { student: { first_name: { contains: term, mode: "insensitive" } } },
        { student: { last_name: { contains: term, mode: "insensitive" } } },
        { transactions: { some: { receipt_number: { contains: term, mode: "insensitive" } } } },
        { period: { contains: term } },
      ];
    }

    return where;
  }

  async findOne(paymentId: string) {
    const payment = await this.prisma.student_payments.findUnique({
      where: { id: paymentId },
      include: PAYMENT_INCLUDE_FULL,
    });
    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);
    return this.present(payment);
  }

  /** Every invoice for one student, newest first, each with its ledger. */
  async historyForStudent(studentId: string) {
    const rows = await this.prisma.student_payments.findMany({
      where: { student_id: studentId },
      include: PAYMENT_INCLUDE_FULL,
      orderBy: { period: "desc" },
    });
    return rows.map((row) => this.present(row));
  }

  /**
   * Adds the figures the UI would otherwise have to derive — and would derive
   * inconsistently across the seven screens that show a payment.
   */
  private present(payment: PaymentWithContext) {
    const due = money(payment.amount_due);
    const paid = money(payment.paid_amount);
    const professor = payment.group?.professor ?? payment.student?.group?.professor ?? null;
    const field = professor?.field ?? null;

    const chain = new Map<string, { type: string; id: string; name: string; color: string | null }>();
    const add = (type: string, id: string, name: string, color: string | null) => {
      if (!id) return;
      chain.set(`${type}:${id}`, { type, id, name, color });
    };

    const walk = (g?: { id: string; name: string; color: string | null } | null, p?: { id: string; full_name: string; color: string | null } | null, f?: { id: string; name: string; color: string | null } | null, l?: { id: string; name: string; color: string | null } | null) => {
      add("group", g?.id ?? "", g?.name ?? "", g?.color ?? null);
      add("professor", p?.id ?? "", p?.full_name ?? "", p?.color ?? null);
      add("field", f?.id ?? "", f?.name ?? "", f?.color ?? null);
      add("level", l?.id ?? "", l?.name ?? "", l?.color ?? null);
    };

    if (payment.group) {
      const gp = payment.group.professor;
      const gf = gp?.field;
      const gl = gf?.level;
      walk(payment.group, gp, gf, gl);
    }
    if (payment.student?.group) {
      const gp = payment.student.group.professor;
      const gf = gp?.field;
      const gl = gf?.level;
      walk(payment.student.group, gp, gf, gl);
    }
    for (const a of (payment.student as any)?.assignments ?? []) {
      const g = a.group;
      if (!g) continue;
      const p = g.professor;
      const f = p?.field;
      const l = f?.level;
      walk(g, p, f, l);
    }

    const groups = [...chain.values()].filter((c) => c.type === "group");
    const professors = [...chain.values()].filter((c) => c.type === "professor");
    const fields = [...chain.values()].filter((c) => c.type === "field");
    const levels = [...chain.values()].filter((c) => c.type === "level");

    return {
      ...payment,
      amount_due: toAmount(due),
      paid_amount: payment.paid_amount === null ? null : toAmount(paid),
      remaining_balance: toAmount(round2(due.minus(paid))),
      is_settled: paid.greaterThanOrEqualTo(due),
      receipt_number: payment.transactions.find((t) => t.type === "payment")?.receipt_number ?? null,
      transactions: payment.transactions.map((t) => ({
        ...t,
        amount: toAmount(money(t.amount)),
        professor_share: toAmount(money(t.professor_share)),
        school_share: toAmount(money(t.school_share)),
      })),
      context: {
        student_name: payment.student ? `${payment.student.first_name} ${payment.student.last_name}` : null,
        group: payment.group ? { id: payment.group.id, name: payment.group.name, color: payment.group.color } : null,
        professor: professor ? { id: professor.id, name: professor.full_name, color: professor.color } : null,
        field: field ? { id: field.id, name: field.name, color: field.color } : null,
        level: field?.level ? { id: field.level.id, name: field.level.name, color: field.level.color } : null,
        groups,
        professors,
        fields,
        levels,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Writing
  // ---------------------------------------------------------------------------

  /**
   * Takes cash against an invoice.
   *
   * Omitting `amount` settles the outstanding balance. Supplying less records a
   * partial payment and leaves the invoice open for another instalment; the
   * status follows from the ledger total rather than from what the caller
   * intended, so "pay 30 of 100" and "pay 70 then 30" end in the same state.
   */
  async recordTransaction(paymentId: string, userId: string, dto: RecordTransactionDto) {
    return this.appendTransaction({
      paymentId,
      userId,
      type: "payment",
      requestedAmount: dto.amount ?? null,
      notes: dto.notes,
      paidAt: dto.paid_at ? new Date(dto.paid_at) : new Date(),
      issueReceipt: true,
      auditAction: "payment.transaction_recorded",
    });
  }

  /**
   * Reverses money already taken.
   *
   * Recorded as a negative row rather than by editing or deleting the original,
   * so the collection still appears in the month it happened and the refund in
   * the month it was issued — which is what an accountant needs to see. The
   * professor's share is reversed in the same proportion it was granted.
   */
  async refund(paymentId: string, userId: string, dto: RefundTransactionDto) {
    const amount = money(dto.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException("A refund amount must be greater than zero");
    }

    const payment = await this.requirePayment(paymentId);
    const alreadyPaid = money(payment.paid_amount);
    if (amount.greaterThan(alreadyPaid)) {
      throw new BadRequestException(
        `Cannot refund ${toAmount(amount)} — only ${toAmount(alreadyPaid)} has been collected against this invoice`,
      );
    }

    return this.appendTransaction({
      paymentId,
      userId,
      type: "refund",
      requestedAmount: amount.negated().toFixed(2),
      notes: dto.notes,
      reason: dto.reason,
      paidAt: new Date(),
      issueReceipt: true,
      auditAction: "payment.refunded",
    });
  }

  /**
   * Adjusts a mis-keyed collection by a signed delta.
   *
   * A correction is deliberately not an edit of the original row: the books show
   * what was recorded and what was put right, which is the difference between an
   * auditable ledger and one that can be quietly rewritten.
   */
  async correct(paymentId: string, userId: string, dto: CorrectTransactionDto) {
    const delta = money(dto.amount);
    if (delta.isZero()) {
      throw new BadRequestException("A correction of zero changes nothing");
    }

    const payment = await this.requirePayment(paymentId);
    const resulting = money(payment.paid_amount).plus(delta);
    if (resulting.isNegative()) {
      throw new BadRequestException(
        `That correction would take the collected total to ${toAmount(resulting)}, which cannot be negative`,
      );
    }

    return this.appendTransaction({
      paymentId,
      userId,
      type: "correction",
      requestedAmount: delta.toFixed(2),
      notes: dto.notes,
      reason: dto.reason,
      paidAt: new Date(),
      // A correction adjusts an existing receipt rather than issuing a new one.
      issueReceipt: false,
      auditAction: "payment.corrected",
    });
  }

  /**
   * The single write path for every movement of money.
   *
   * Everything happens in one database transaction: mint the receipt number,
   * price the split, append the ledger row, then recompute the invoice's total
   * and status from the ledger. Recomputing rather than incrementing is what
   * makes the invariant hold even if two collections land at once — the second
   * transaction re-reads the ledger it is about to be part of.
   */
  private async appendTransaction(input: {
    paymentId: string;
    userId: string;
    type: TransactionType;
    requestedAmount: string | null;
    notes?: string;
    reason?: string;
    paidAt: Date;
    issueReceipt: boolean;
    auditAction: string;
  }) {
    const payment = await this.requirePayment(input.paymentId);

    if (payment.status === "cancelled") {
      throw new BadRequestException(
        "This invoice is cancelled. Reopen it before recording anything against it.",
      );
    }

    // The invoice's own group owns the money: the professor compensated for
    // this collection is the one whose group the invoice bills, which for a
    // multi-group student is the enrollment this invoice covers.
    const profId = payment.group?.prof_id ?? payment.student?.group?.prof_id ?? null;

    // Defaulting to the outstanding balance is what makes the common case at the
    // desk a single click.
    const outstanding = round2(money(payment.amount_due).minus(money(payment.paid_amount)));
    const amount: Money = input.requestedAmount !== null ? money(input.requestedAmount) : outstanding;

    if (input.type === "payment") {
      if (amount.lessThanOrEqualTo(0)) {
        throw new BadRequestException(
          outstanding.lessThanOrEqualTo(0)
            ? "This invoice is already settled in full"
            : "A payment amount must be greater than zero",
        );
      }
      // Overpayment is almost always a keying slip, and letting it through would
      // put the invoice into a state no status describes.
      if (amount.greaterThan(outstanding)) {
        throw new BadRequestException(
          `That is more than the ${toAmount(outstanding)} outstanding on this invoice`,
        );
      }
    }

    const counts = profId ? await this.revenue.rosterCounts(profId) : { studentCount: 0, groupCount: 0 };
    const split = await this.revenue.splitTransaction({
      amount,
      profId,
      period: payment.period,
      studentCount: counts.studentCount,
      groupCount: counts.groupCount,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const receiptNumber = input.issueReceipt
        ? await this.receipts.next(tx, "payment", input.paidAt)
        : null;

      const transaction = await tx.payment_transactions.create({
        data: {
          payment_id: input.paymentId,
          type: input.type,
          amount: amount.toFixed(2),
          method: "cash",
          receipt_number: receiptNumber,
          paid_at: input.paidAt,
          recorded_by: input.userId,
          notes: input.notes ?? null,
          reason: input.reason ?? null,
          professor_share: split.professorShare.toFixed(2),
          school_share: split.schoolShare.toFixed(2),
          compensation_model: split.model,
          compensation_snapshot: split.snapshot,
          prof_id: profId,
          period: payment.period,
        },
      });

      const updated = await this.reconcile(tx, input.paymentId);
      return { transaction, updated };
    });

    await this.audit.record({
      action: input.auditAction,
      entityType: "student_payment",
      entityId: input.paymentId,
      entityLabel: `${payment.period} · ${toAmount(amount)}`,
      actorId: input.userId,
      prevValues: {
        status: payment.status,
        paid_amount: toAmount(money(payment.paid_amount)),
      },
      newValues: {
        status: result.updated.status,
        paid_amount: toAmount(money(result.updated.paid_amount)),
        transaction_type: input.type,
        amount: toAmount(amount),
        receipt_number: result.transaction.receipt_number,
        professor_share: toAmount(split.professorShare),
        school_share: toAmount(split.schoolShare),
      },
      meta: {
        student_id: payment.student_id,
        prof_id: profId,
        period: payment.period,
        reason: input.reason ?? null,
        compensation_model: split.model,
      },
    });

    return this.findOne(input.paymentId);
  }

  /**
   * Rewrites an invoice's total and status from its ledger.
   *
   * The only place either column is set. Callers pass the transaction client so
   * this runs inside the write that made it necessary.
   */
  private async reconcile(tx: Prisma.TransactionClient, paymentId: string) {
    const [payment, aggregate, settings] = await Promise.all([
      tx.student_payments.findUniqueOrThrow({ where: { id: paymentId } }),
      tx.payment_transactions.aggregate({ where: { payment_id: paymentId }, _sum: { amount: true } }),
      this.settings.get(),
    ]);

    const collected = round2(money(aggregate._sum.amount));
    const due = money(payment.amount_due);

    const status =
      payment.status === "cancelled"
        ? "cancelled"
        : this.deriveStatus(collected, due, payment.due_date, settings.due_soon_days);

    // The last payment's timestamp is what a receipt and the "paid on" column
    // should show; it is null again the moment the ledger nets back to nothing.
    const lastPaidAt = collected.greaterThan(0)
      ? ((
          await tx.payment_transactions.findFirst({
            where: { payment_id: paymentId, amount: { gt: 0 } },
            orderBy: { paid_at: "desc" },
            select: { paid_at: true },
          })
        )?.paid_at ?? null)
      : null;

    return tx.student_payments.update({
      where: { id: paymentId },
      data: {
        paid_amount: collected.isZero() ? null : collected.toFixed(2),
        status,
        paid_at: lastPaidAt,
        payment_method: collected.greaterThan(0) ? "cash" : null,
        recorded_by: collected.greaterThan(0) ? payment.recorded_by : null,
      },
    });
  }

  /**
   * The one definition of what an invoice's status means.
   *
   * Ordered most-settled first: a fully paid invoice is never also overdue, and
   * a partially paid one stays `partially_paid` past its due date rather than
   * losing the fact that money came in. Unpaid invoices are `due_soon` in the
   * last `dueSoonDays` before the due date — strictly after today, so an
   * invoice due today is plain `not_paid`, as is a just-created one — and
   * there is no `overdue` state, a late invoice is simply unpaid.
   */
  private deriveStatus(collected: Money, due: Money, dueDate: Date, dueSoonDays: number): PaymentStatus {
    if (collected.greaterThanOrEqualTo(due) && due.greaterThan(0)) return "paid";
    if (collected.greaterThan(0)) return "partially_paid";

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const soon = new Date(today);
    soon.setUTCDate(soon.getUTCDate() + dueSoonDays);
    if (dueDate > today && dueDate <= soon) return "due_soon";

    return "not_paid";
  }

  /**
   * Voids an invoice without deleting it.
   *
   * Refused once money has been taken: the collection would vanish from revenue
   * while the cash sat in the drawer. Refund it first, which leaves both halves
   * of the story on the record.
   */
  async cancel(paymentId: string, userId: string, dto: CancelPaymentDto) {
    const payment = await this.requirePayment(paymentId);

    if (money(payment.paid_amount).greaterThan(0)) {
      throw new BadRequestException(
        "This invoice has money against it. Refund the collected amount before cancelling.",
      );
    }
    if (payment.status === "cancelled") {
      throw new BadRequestException("This invoice is already cancelled");
    }

    const updated = await this.prisma.student_payments.update({
      where: { id: paymentId },
      data: {
        status: "cancelled",
        notes: dto.reason,
      },
    });

    await this.audit.record({
      action: "payment.cancelled",
      entityType: "student_payment",
      entityId: paymentId,
      entityLabel: payment.period,
      actorId: userId,
      prevValues: { status: payment.status },
      newValues: { status: "cancelled" },
      meta: { student_id: payment.student_id, reason: dto.reason },
    });

    return this.findOne(updated.id);
  }

  /** Puts a cancelled invoice back into circulation, recomputing its status. */
  async reopen(paymentId: string, userId: string) {
    const payment = await this.requirePayment(paymentId);
    if (payment.status !== "cancelled") {
      throw new BadRequestException("Only a cancelled invoice can be reopened");
    }

    await this.prisma.$transaction(async (tx) => {
      // Clear the cancellation first so `reconcile` derives a live status.
      await tx.student_payments.update({ where: { id: paymentId }, data: { status: "not_paid" } });
      await this.reconcile(tx, paymentId);
    });

    await this.audit.record({
      action: "payment.reopened",
      entityType: "student_payment",
      entityId: paymentId,
      entityLabel: payment.period,
      actorId: userId,
      prevValues: { status: "cancelled" },
      newValues: { status: "not_paid" },
      meta: { student_id: payment.student_id },
    });

    return this.findOne(paymentId);
  }

  /**
   * Admin override of an invoice's status.
   *
   * The pending labels (`not_paid` / `due_soon`) can always be set; the
   * money-bearing ones are checked against the ledger so the status can never
   * contradict the invoice's own history — `paid` requires the full amount
   * collected, `partially_paid` requires some of it, and `cancelled` requires
   * none of it. Every change is audited with the caller and an optional reason.
   */
  async updateStatus(paymentId: string, userId: string, dto: UpdatePaymentStatusDto) {
    const payment = await this.requirePayment(paymentId);
    const target = dto.status;

    if (payment.status === target) return this.findOne(paymentId);

    const collected = money(payment.paid_amount ?? 0);
    const due = money(payment.amount_due);

    if ((target === "not_paid" || target === "due_soon") && collected.greaterThan(0)) {
      throw new BadRequestException(
        "Money has been collected against this invoice — its status is derived from the ledger",
      );
    }
    if (target === "paid" && collected.lessThan(due)) {
      throw new BadRequestException(
        `Marking this invoice paid requires ${toAmount(due.minus(collected))} to be collected — record the payment instead`,
      );
    }
    if (target === "partially_paid" && (collected.lessThanOrEqualTo(0) || collected.greaterThanOrEqualTo(due))) {
      throw new BadRequestException(
        "partially_paid is derived from the ledger — record a partial payment instead",
      );
    }
    if (target === "cancelled" && collected.greaterThan(0)) {
      throw new BadRequestException(
        "This invoice has money against it. Refund the collected amount before cancelling.",
      );
    }

    const updated = await this.prisma.student_payments.update({
      where: { id: paymentId },
      data: { status: target },
    });

    await this.audit.record({
      action: "payment.status_updated",
      entityType: "student_payment",
      entityId: paymentId,
      entityLabel: payment.period,
      actorId: userId,
      prevValues: { status: payment.status },
      newValues: { status: target },
      meta: { student_id: payment.student_id, reason: dto.reason ?? null },
    });

    return this.findOne(updated.id);
  }

  private async requirePayment(paymentId: string): Promise<PaymentWithContext> {
    const payment = await this.prisma.student_payments.findUnique({
      where: { id: paymentId },
      include: PAYMENT_INCLUDE_FULL,
    });
    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);
    return payment;
  }

  // ---------------------------------------------------------------------------
  // Invoice generation — unchanged in behaviour from the module this replaces
  // ---------------------------------------------------------------------------

  /**
   * Bills every active student from their enrolment through the current month,
   * plus `months` further months ahead — one invoice per enrollment per month.
   * A multi-group student gets one invoice per group per period, so billing
   * three months ahead for a two-group student creates six invoices.
   *
   * `months = 0` (the default) bills exactly the months since each student's
   * inscription through the actual month — the renewal pass. Everything lands
   * in a single `createMany` and already-billed periods are skipped, so a whole
   * school of students renews in one call.
   */
  async generateMonthly(months = 0) {
    const count = Math.min(Math.max(Math.floor(months) || 0, 0), 12);
    const today = new Date();

    const activeStudents = await this.prisma.students.findMany({
      where: { status: "active" },
      select: {
        id: true,
        group_id: true,
        enrollment_date: true,
        monthly_fee: true,
        assignments: { select: { group_id: true, fee: true } },
      },
    });
    if (activeStudents.length === 0) return [];

    const records: any[] = [];
    const seen = new Set<string>();

    for (const student of activeStudents) {
      const periods = billingPeriods(student.enrollment_date, today);
      if (count > 0) {
        const lastCursor = today.getUTCFullYear() * 12 + today.getUTCMonth();
        for (let i = 1; i <= count; i++) {
          const cursor = lastCursor + i;
          const year = Math.floor(cursor / 12);
          const month = cursor % 12;
          periods.push({ year, month, period: periodOf(year, month) });
        }
      }

      const enrollments = student.assignments.length > 0
        ? student.assignments
        : [{ group_id: student.group_id, fee: student.monthly_fee }];

      for (const a of enrollments) {
        for (const p of periods) {
          const key = `${student.id}:${a.group_id}:${p.period}`;
          if (seen.has(key)) continue;
          seen.add(key);
          records.push({
            student_id: student.id,
            group_id: a.group_id,
            period: p.period,
            amount_due: a.fee.toString(),
            due_date: dueDateFor(p.year, p.month, student.enrollment_date),
            status: "not_paid" as PaymentStatus,
          });
        }
      }
    }

    if (records.length === 0) return [];
    await this.prisma.student_payments.createMany({ data: records, skipDuplicates: true });
    return records;
  }

  /**
   * Creates whatever one student still owes, from enrolment through this month,
   * plus `monthsAhead` further months — so a parent paying the term upfront can
   * have every upcoming invoice generated in one click.
   */
  async generateForStudent(studentId: string, monthsAhead = 0) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        group_id: true,
        enrollment_date: true,
        monthly_fee: true,
        status: true,
        assignments: { select: { group_id: true, fee: true } },
      },
    });
    if (!student || student.status !== "active") return [];

    const now = new Date();
    const periods = billingPeriods(student.enrollment_date, now);

    const ahead = Math.min(Math.max(Math.floor(monthsAhead) || 0, 0), 12);
    if (ahead > 0) {
      const lastCursor = now.getUTCFullYear() * 12 + now.getUTCMonth();
      for (let i = 1; i <= ahead; i++) {
        const cursor = lastCursor + i;
        periods.push({
          year: Math.floor(cursor / 12),
          month: cursor % 12,
          period: periodOf(Math.floor(cursor / 12), cursor % 12),
        });
      }
    }
    if (periods.length === 0) return [];

    const billed = await this.prisma.student_payments.findMany({
      where: { student_id: studentId, period: { in: periods.map((p) => p.period) } },
      select: { period: true, group_id: true },
    });
    const alreadyBilled = new Set(billed.map((p) => `${p.group_id}:${p.period}`));

    const enrollments = student.assignments.length > 0
      ? student.assignments
      : [{ group_id: student.group_id, fee: student.monthly_fee }];

    const records = periods.flatMap((p) =>
      enrollments
        .filter((a) => !alreadyBilled.has(`${a.group_id}:${p.period}`))
        .map((a) => ({
          student_id: student.id,
          group_id: a.group_id,
          period: p.period,
          amount_due: a.fee.toString(),
          due_date: dueDateFor(p.year, p.month, student.enrollment_date),
          status: "not_paid" as PaymentStatus,
        })),
    );

    if (records.length === 0) return [];
    await this.prisma.student_payments.createMany({ data: records, skipDuplicates: true });

    return this.prisma.student_payments.findMany({
      where: { student_id: studentId, period: { in: records.map((r) => r.period) } },
      orderBy: { period: "asc" },
    });
  }

  /**
   * Rolls unsettled invoices into `due_soon` / `not_paid`.
   *
   * `partially_paid` is deliberately excluded: money has been taken against
   * those, and relabelling them would lose that. They surface in the outstanding
   * report by balance instead.
   *
   * There is no `overdue` state: an invoice is `due_soon` in the two days before
   * its due date, and plain `not_paid` once the date passes — so this also
   * unwinds legacy rows that were labelled overdue before that rule existed.
   */
  async refreshStatuses(studentId?: string) {
    const settings = await this.settings.get();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const soon = new Date(today);
    soon.setUTCDate(soon.getUTCDate() + settings.due_soon_days);

    const scope = studentId ? { student_id: studentId } : {};

    const [expiredSoon, dueSoon, legacyOverdue] = await Promise.all([
      this.prisma.student_payments.updateMany({
        // `lte` rather than `lt`: the due_soon window starts strictly after
        // today, so anything due today or earlier is no longer due soon.
        where: { ...scope, status: "due_soon", due_date: { lte: today } },
        data: { status: "not_paid" },
      }),
      this.prisma.student_payments.updateMany({
        where: { ...scope, status: "not_paid", due_date: { gt: today, lte: soon } },
        data: { status: "due_soon" },
      }),
      this.prisma.student_payments.updateMany({
        where: { ...scope, status: "overdue" },
        data: { status: "not_paid" },
      }),
    ]);

    return {
      overdue: legacyOverdue.count,
      dueSoon: dueSoon.count,
      total: expiredSoon.count + dueSoon.count + legacyOverdue.count,
    };
  }
}
