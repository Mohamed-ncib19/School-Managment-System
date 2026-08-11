import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, SQL } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { auditLogs, paymentTransactions } from "../db/schema";
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
 */
@Injectable()
export class TransactionService {
  constructor(
    private readonly db: DbService,
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

    const clauses: (SQL | undefined)[] = [
      transactionWhere({
        levelId: query.levelId,
        fieldId: query.fieldId,
        profId: query.profId,
        groupId: query.groupId,
        studentId: query.studentId,
      }),
      gte(paymentTransactions.paid_at, range.from),
      lte(paymentTransactions.paid_at, range.to),
      query.type ? eq(paymentTransactions.type, query.type) : undefined,
      query.period ? eq(paymentTransactions.period, query.period) : undefined,
    ];

    if (query.search?.trim()) {
      const term = query.search.trim();
      clauses.push(
        or(
          ilike(paymentTransactions.receipt_number, `%${term}%`),
          ilike(paymentTransactions.notes, `%${term}%`),
          ilike(paymentTransactions.reason, `%${term}%`),
          sql`exists(select 1 from student_payments sp2 join students st on st.id = sp2.student_id where sp2.id = ${paymentTransactions.payment_id} and st.first_name ilike ${`%${term}%`})`,
          sql`exists(select 1 from student_payments sp2 join students st on st.id = sp2.student_id where sp2.id = ${paymentTransactions.payment_id} and st.last_name ilike ${`%${term}%`})`,
        ),
      );
    }

    const where = and(...clauses);

    const [rows, [countRow], [sumRow]] = await Promise.all([
      this.db.client.query.paymentTransactions.findMany({
        where,
        orderBy: [desc(paymentTransactions.paid_at)],
        offset: (page - 1) * limit,
        limit,
        with: {
          user: { columns: { id: true, full_name: true } },
          professor: { columns: { id: true, full_name: true } },
          studentPayment: {
            columns: { id: true, period: true, amount_due: true },
            with: {
              student: { columns: { id: true, first_name: true, last_name: true } },
              group: {
                columns: { id: true, name: true },
                with: {
                  professor: {
                    columns: { id: true, full_name: true },
                    with: {
                      field: {
                        columns: { id: true, name: true },
                        with: { level: { columns: { id: true, name: true } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.db.client.select({ count: sql<number>`count(*)::int` }).from(paymentTransactions).where(where),
      this.db.client
        .select({
          amount: sql<string | null>`sum(${paymentTransactions.amount})`,
          professor_share: sql<string | null>`sum(${paymentTransactions.professor_share})`,
          school_share: sql<string | null>`sum(${paymentTransactions.school_share})`,
        })
        .from(paymentTransactions)
        .where(where),
    ]);

    return {
      data: rows.map((row) => {
        const student = row.studentPayment?.student;
        const group = row.studentPayment?.group;
        const field = group?.professor?.field;
        return {
          id: row.id,
          payment_id: row.payment_id,
          type: row.type,
          amount: toAmount(money(row.amount)),
          professor_share: toAmount(money(row.professor_share)),
          school_share: toAmount(money(row.school_share)),
          compensation_model: row.compensationModel,
          compensation_snapshot: row.compensation_snapshot,
          receipt_number: row.receipt_number,
          method: row.method,
          paid_at: row.paid_at,
          period: row.period,
          notes: row.notes,
          reason: row.reason,
          recorded_by: row.user ? { id: row.user.id, name: row.user.full_name } : null,
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
        total: countRow.count,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(countRow.count / limit)),
        totals: {
          amount: toAmount(round2(money(sumRow.amount))),
          professor_share: toAmount(round2(money(sumRow.professor_share))),
          school_share: toAmount(round2(money(sumRow.school_share))),
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

    const clauses: SQL[] = [
      params.action ? eq(auditLogs.action, params.action) : (inArray(auditLogs.action, [...FINANCIAL_AUDIT_ACTIONS]) as SQL),
    ];

    if (params.from || params.to) {
      if (params.from) {
        const parsed = new Date(params.from);
        if (!isNaN(parsed.getTime())) clauses.push(gte(auditLogs.created_at, parsed));
      }
      if (params.to) {
        const parsed = new Date(params.to);
        if (!isNaN(parsed.getTime())) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(params.to)) parsed.setHours(23, 59, 59, 999);
          clauses.push(lte(auditLogs.created_at, parsed));
        }
      }
    }

    if (params.search?.trim()) {
      const term = params.search.trim();
      clauses.push(
        or(
          ilike(auditLogs.entity_label, `%${term}%`),
          ilike(auditLogs.actor_label, `%${term}%`),
          ilike(auditLogs.action, `%${term}%`),
          sql`exists(select 1 from users u where u.id = ${auditLogs.actor_user_id} and u.full_name ilike ${`%${term}%`})`,
        ) as SQL,
      );
    }

    const where = and(...clauses);

    const [data, [countRow]] = await Promise.all([
      this.db.client.query.auditLogs.findMany({
        where,
        with: { user: { columns: { id: true, full_name: true, email: true } } },
        orderBy: [desc(auditLogs.created_at)],
        offset: (page - 1) * limit,
        limit,
      }),
      this.db.client.select({ count: sql<number>`count(*)::int` }).from(auditLogs).where(where),
    ]);

    return {
      data,
      meta: { total: countRow.count, page, limit, totalPages: Math.max(1, Math.ceil(countRow.count / limit)) },
    };
  }

  /** Distinct financial actions present in the log, for the filter dropdown. */
  async activityActions() {
    const rows = await this.db.client
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(inArray(auditLogs.action, [...FINANCIAL_AUDIT_ACTIONS]))
      .groupBy(auditLogs.action)
      .orderBy(asc(auditLogs.action));
    return rows.map((r) => r.action);
  }
}