import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { FinancialSettingsService } from "./financial-settings.service";
import { money, round2, toAmount } from "./money.util";
import { resolveRange, transactionWhere } from "./financial.filters";
import type { TransactionQueryDto } from "./dto/analytics.dto";

/**
 * Every action in the financial domain that is worth being able to look up
 * afterwards. The prefixes match what the services write.
 */
export const FINANCIAL_AUDIT_ACTIONS = [
  "payment.transaction_recorded",
  "payment.refunded",
  "payment.corrected",
  "payment.cancelled",
  "payment.reopened",
  "payment.recorded",
  "payment.status_changed",
  "payroll.paid",
  "payroll.modified",
  "payroll.deleted",
  "receipt.generated",
  "financial.settings_updated",
  "financial.formula_changed",
] as const;

/**
 * Transaction History.
 *
 * Two distinct records, deliberately kept separate rather than merged into one
 * feed:
 *
 *   the **ledger** — what money did. Every payment, refund and correction, with
 *   the split that was applied. This is the accounting record.
 *
 *   the **activity trail** — what people did. Drawn from `audit_logs`, so it
 *   also carries the actions that move no money but change what money means:
 *   a percentage changed, an invoice cancelled, a receipt printed. It already
 *   records actor, IP, user agent and before/after values.
 *
 * Merging them would produce a feed where a settings change and a 40 DT payment
 * sit in the same list with no way to total either.
 */
@Injectable()
export class TransactionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: FinancialSettingsService,
  ) {}

  /** The money ledger, filtered and paginated. */
  async ledger(query: TransactionQueryDto) {
    const settings = await this.settings.get();
    const range = resolveRange(
      query,
      query.granularity ?? "monthly",
      settings.academic_year_start_month,
    );

    const page = query.page ?? 1;
    const limit = query.pageLimit ?? 50;

    const where: Prisma.payment_transactionsWhereInput = {
      ...transactionWhere({
        levelId: query.levelId,
        fieldId: query.fieldId,
        profId: query.profId,
        groupId: query.groupId,
        studentId: query.studentId,
      }),
      paid_at: { gte: range.from, lte: range.to },
      ...(query.type ? { type: query.type } : {}),
      ...(query.period ? { period: query.period } : {}),
    };

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { receipt_number: { contains: term, mode: "insensitive" } },
        { notes: { contains: term, mode: "insensitive" } },
        { reason: { contains: term, mode: "insensitive" } },
        { payment: { student: { first_name: { contains: term, mode: "insensitive" } } } },
        { payment: { student: { last_name: { contains: term, mode: "insensitive" } } } },
      ];
    }

    const [rows, total, totals] = await Promise.all([
      this.prisma.payment_transactions.findMany({
        where,
        orderBy: { paid_at: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          recorder: { select: { id: true, full_name: true } },
          professor: { select: { id: true, full_name: true } },
          payment: {
            select: {
              id: true,
              period: true,
              amount_due: true,
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
                      field: { select: { id: true, name: true, level: { select: { id: true, name: true } } } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.payment_transactions.count({ where }),
      this.prisma.payment_transactions.aggregate({
        where,
        _sum: { amount: true, professor_share: true, school_share: true },
      }),
    ]);

    return {
      data: rows.map((row) => {
        const student = row.payment?.student;
        const group = row.payment?.group;
        const field = group?.professor?.field;
        return {
          id: row.id,
          payment_id: row.payment_id,
          type: row.type,
          amount: toAmount(money(row.amount)),
          professor_share: toAmount(money(row.professor_share)),
          school_share: toAmount(money(row.school_share)),
          compensation_model: row.compensation_model,
          compensation_snapshot: row.compensation_snapshot,
          receipt_number: row.receipt_number,
          method: row.method,
          paid_at: row.paid_at,
          period: row.period,
          notes: row.notes,
          reason: row.reason,
          recorded_by: row.recorder ? { id: row.recorder.id, name: row.recorder.full_name } : null,
          student: student ? { id: student.id, name: `${student.first_name} ${student.last_name}` } : null,
          group: group ? { id: group.id, name: group.name } : null,
          professor: row.professor
            ? { id: row.professor.id, name: row.professor.full_name }
            : group?.professor
              ? { id: group.professor.id, name: group.professor.full_name }
              : null,
          field: field ? { id: field.id, name: field.name } : null,
          level: field?.level ? { id: field.level.id, name: field.level.name } : null,
        };
      }),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        totals: {
          amount: toAmount(round2(money(totals._sum.amount))),
          professor_share: toAmount(round2(money(totals._sum.professor_share))),
          school_share: toAmount(round2(money(totals._sum.school_share))),
        },
      },
    };
  }

  /**
   * The activity trail: financial actions from the audit log.
   *
   * Scoped by action prefix rather than by entity type, because a formula change
   * and a cancelled invoice touch different tables but belong on the same
   * screen.
   */
  async activity(params: { page?: number; limit?: number; action?: string; from?: string; to?: string; search?: string }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;

    const where: Prisma.audit_logsWhereInput = {
      action: params.action
        ? { equals: params.action }
        : { in: [...FINANCIAL_AUDIT_ACTIONS] },
    };

    if (params.from || params.to) {
      const created: Prisma.DateTimeFilter = {};
      if (params.from) {
        const parsed = new Date(params.from);
        if (!isNaN(parsed.getTime())) created.gte = parsed;
      }
      if (params.to) {
        const parsed = new Date(params.to);
        if (!isNaN(parsed.getTime())) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(params.to)) parsed.setHours(23, 59, 59, 999);
          created.lte = parsed;
        }
      }
      if (created.gte || created.lte) where.created_at = created;
    }

    if (params.search?.trim()) {
      const term = params.search.trim();
      where.AND = [
        {
          OR: [
            { entity_label: { contains: term, mode: "insensitive" } },
            { actor_label: { contains: term, mode: "insensitive" } },
            { action: { contains: term, mode: "insensitive" } },
            { actor: { is: { full_name: { contains: term, mode: "insensitive" } } } },
          ],
        },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.audit_logs.findMany({
        where,
        include: { actor: { select: { id: true, full_name: true, email: true } } },
        orderBy: { created_at: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.audit_logs.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /** Distinct financial actions present in the log, for the filter dropdown. */
  async activityActions() {
    const rows = await this.prisma.audit_logs.findMany({
      where: { action: { in: [...FINANCIAL_AUDIT_ACTIONS] } },
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    });
    return rows.map((r) => r.action);
  }
}
