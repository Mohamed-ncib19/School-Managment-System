import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, gt, gte, inArray, like, lte, or, sql, SQL } from "drizzle-orm";
import { DbService, Tx } from "../db/db.service";
import { paymentStatus, paymentTransactions, studentPayments, students, transactionType } from "../db/schema";
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

type PaymentStatus = (typeof paymentStatus.enumValues)[number];
type TransactionType = (typeof transactionType.enumValues)[number];

/** French diacritics and their plain equivalents, in matching order (for SQL translate). */
const DIACRITICS = "àâäçéèêëîïôöùûüÿ";
const PLAIN = "aaaceeeeiioouuuy";

/** Keywords a cashier might type to target a status, in unaccented lowercase. */
const SEARCH_STATUS_ALIASES: Record<string, PaymentStatus> = {
  paye: "paid",
  encaisse: "paid",
  solde: "paid",
  nonpaye: "not_paid",
  impaye: "not_paid",
  bientot: "due_soon",
  retard: "overdue",
  partiel: "partially_paid",
  partiellement: "partially_paid",
  annule: "cancelled",
};

/** French month names → period month, so "juin 2025" targets 2025-06. */
const SEARCH_MONTHS: Record<string, string> = {
  janvier: "01", janv: "01",
  fevrier: "02", fev: "02",
  mars: "03",
  avril: "04", avr: "04",
  mai: "05",
  juin: "06",
  juillet: "07", juil: "07",
  aout: "08",
  septembre: "09", sept: "09",
  octobre: "10", oct: "10",
  novembre: "11", nov: "11",
  decembre: "12", dec: "12",
};

const SEARCH_STOP_WORDS = new Set([
  "en", "de", "du", "des", "au", "aux", "le", "la", "les", "un", "une",
  "non", "pas", "et", "ou", "pour", "avec", "tout", "tous", "toutes",
]);

/** Lower rank = more urgent. A student's ledger status is its worst invoice. */
const STATUS_RANK: Record<string, number> = {
  overdue: 0,
  due_soon: 1,
  not_paid: 2,
  partially_paid: 3,
  paid: 4,
  cancelled: 5,
};

/** Lowercases and strips French diacritics so "méité" == "meite". */
function unaccent(value: string): string {
  return value
    .toLowerCase()
    .replace(/[àâä]/g, "a")
    .replace(/ç/g, "c")
    .replace(/[éèêë]/g, "e")
    .replace(/[îï]/g, "i")
    .replace(/[ôö]/g, "o")
    .replace(/[ùûü]/g, "u")
    .replace(/ÿ/g, "y");
}

interface GroupBrief {
  id: string;
  name: string;
  color: string | null;
  prof_id: string;
  professor: {
    id: string;
    full_name: string;
    color: string | null;
    field: {
      id: string;
      name: string;
      color: string | null;
      level: { id: string; name: string; color: string | null } | null;
    } | null;
  } | null;
}

interface TransactionRow {
  id: string;
  type: TransactionType;
  amount: string;
  professor_share: string;
  school_share: string;
  receipt_number: string | null;
  paid_at: Date;
  user: { id: string; full_name: string } | null;
}

/** The invoice plus everything the UI needs to render a row without a second call. */
const PROFESSOR_WITH = {
  columns: { id: true, full_name: true, color: true },
  with: {
    field: {
      columns: { id: true, name: true, color: true },
      with: { level: { columns: { id: true, name: true, color: true } } },
    },
  },
} as const;

const GROUP_WITH = {
  columns: { id: true, name: true, color: true, prof_id: true },
  with: { professor: PROFESSOR_WITH },
} as const;

const PAYMENT_WITH = {
  student: { with: { group: GROUP_WITH } },
  group: GROUP_WITH,
  paymentTransactions: { with: { user: { columns: { id: true, full_name: true } } } },
} as const;

const PAYMENT_WITH_FULL = {
  student: {
    with: {
      group: GROUP_WITH,
      assignments: { with: { group: GROUP_WITH } },
    },
  },
  group: GROUP_WITH,
  paymentTransactions: { with: { user: { columns: { id: true, full_name: true } } } },
} as const;

/** The raw relational row the presentation layer reads. */
interface PaymentRow {
  id: string;
  student_id: string;
  group_id: string;
  period: string;
  amount_due: string;
  paid_amount: string | null;
  due_date: Date;
  status: string;
  notes: string | null;
  paid_at: Date | null;
  student: {
    id: string;
    first_name: string;
    last_name: string;
    group: GroupBrief | null;
    assignments?: { group: GroupBrief | null }[];
  } | null;
  group: GroupBrief | null;
  paymentTransactions: TransactionRow[];
}

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
    private readonly db: DbService,
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
    if (query.view === "students") return this.listStudents(query);

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where = this.buildWhere(query);

    const sortBy = query.sortBy ?? "due_date";
    const sortDir = query.sortDir ?? "desc";
    const allowedSortKeys: Record<string, boolean> = {
      paid_at: true,
      period: true,
      amount_due: true,
      due_date: true,
      status: true,
    };
    const sortKey: string = allowedSortKeys[sortBy] ? sortBy : "due_date";
    const sortCol = sortKey === "paid_at"
      ? studentPayments.paid_at
      : sortKey === "period"
        ? studentPayments.period
        : sortKey === "amount_due"
          ? studentPayments.amount_due
          : sortKey === "status"
            ? studentPayments.status
            : studentPayments.due_date;

    const [rows, total, totals] = await Promise.all([
      this.db.client.query.studentPayments.findMany({
        where,
        with: PAYMENT_WITH,
        orderBy: [sortDir === "desc" ? desc(sortCol) : asc(sortCol)],
        offset: (page - 1) * limit,
        limit,
      }),
      this.db.client
        .select({ count: sql<number>`count(*)::int` })
        .from(studentPayments)
        .where(where)
        .then((r) => r[0].count),
      this.db.client
        .select({
          sum_amount_due: sql<string | null>`sum(${studentPayments.amount_due})`,
          sum_paid_amount: sql<string | null>`sum(${studentPayments.paid_amount})`,
        })
        .from(studentPayments)
        .where(where)
        .then((r) => r[0]),
    ]);

    return {
      data: rows.map((row) => this.present(row)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        totals: {
          amount_due: toAmount(money(totals.sum_amount_due)),
          paid_amount: toAmount(money(totals.sum_paid_amount)),
          outstanding: toAmount(
            round2(money(totals.sum_amount_due).minus(money(totals.sum_paid_amount))),
          ),
        },
      },
    };
  }

  private buildWhere(query: PaymentQueryDto): SQL | undefined {
    const clauses: SQL[] = [];
    const base = paymentWhere(query);
    if (base) clauses.push(base);

    if (query.status) clauses.push(eq(studentPayments.status, query.status));
    if (query.period) clauses.push(eq(studentPayments.period, query.period));
    if (query.year) clauses.push(like(studentPayments.period, `${query.year}-%`));

    if (query.from || query.to) {
      const parsedFrom = query.from ? new Date(query.from) : null;
      const parsedTo = query.to ? new Date(query.to) : null;
      if (parsedFrom && !isNaN(parsedFrom.getTime())) clauses.push(gte(studentPayments.due_date, parsedFrom));
      if (parsedTo && !isNaN(parsedTo.getTime())) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(query.to!)) parsedTo.setUTCHours(23, 59, 59, 999);
        clauses.push(lte(studentPayments.due_date, parsedTo));
      }
    }

    if (query.receiptNumber) {
      const receiptNumber = query.receiptNumber;
      clauses.push(
        sql`exists(select 1 from payment_transactions pt where pt.payment_id = ${studentPayments.id} and pt.receipt_number ilike ${`%${receiptNumber}%`})`,
      );
    }

    if (query.method) {
      const method = query.method;
      clauses.push(
        sql`exists(select 1 from payment_transactions pt where pt.payment_id = ${studentPayments.id} and pt.method = ${method})`,
      );
    }

    if (query.search?.trim()) {
      // Every word must match something (a name, a receipt, a period, a status
      // keyword or a French month), so "jean dupont", "paye" and "juin 2025"
      // all work — and results can only get narrower as the term grows.
      const words = query.search
        .trim()
        .split(/\s+/)
        .map(unaccent)
        .filter((word) => word.length > 0 && !SEARCH_STOP_WORDS.has(word));

      const wordConditions = words.map((word) => {
        const branches: SQL[] = [
          sql`exists(select 1 from students st where st.id = ${studentPayments.student_id} and translate(lower(st.first_name), ${DIACRITICS}, ${PLAIN}) ilike ${`%${word}%`})`,
          sql`exists(select 1 from students st where st.id = ${studentPayments.student_id} and translate(lower(st.last_name), ${DIACRITICS}, ${PLAIN}) ilike ${`%${word}%`})`,
          sql`exists(select 1 from payment_transactions pt where pt.payment_id = ${studentPayments.id} and pt.receipt_number ilike ${`%${word}%`})`,
          like(studentPayments.period, `%${word}%`),
        ];
        const status = SEARCH_STATUS_ALIASES[word];
        if (status) branches.push(eq(studentPayments.status, status));
        const month = SEARCH_MONTHS[word];
        if (month) branches.push(like(studentPayments.period, `%-${month}`));
        return or(...branches) as SQL;
      });

      if (wordConditions.length > 0) clauses.push(and(...wordConditions));
    }

    return clauses.length > 0 ? and(...clauses) : undefined;
  }

  async findOne(paymentId: string) {
    const payment = await this.db.client.query.studentPayments.findFirst({
      where: eq(studentPayments.id, paymentId),
      with: PAYMENT_WITH_FULL,
    });
    if (!payment) throw new NotFoundException(`Paiement ${paymentId} introuvable`);
    return this.present(payment);
  }

  /** Every invoice for one student, newest first, each with its ledger. */
  async historyForStudent(studentId: string) {
    const rows = await this.db.client.query.studentPayments.findMany({
      where: eq(studentPayments.student_id, studentId),
      with: PAYMENT_WITH_FULL,
      orderBy: (p, { desc }) => [desc(p.period)],
    });
    return rows.map((row) => this.present(row));
  }

  /**
   * Adds the figures the UI would otherwise have to derive — and would derive
   * inconsistently across the seven screens that show a payment.
   */
  private present(payment: PaymentRow) {
    const transactions = this.mapTransactions(payment.paymentTransactions);
    const due = money(payment.amount_due);
    const paid = money(payment.paid_amount);
    const context = {
      ...this.buildContext([payment.group, payment.student?.group ?? null], payment.student),
      student_name: payment.student ? `${payment.student.first_name} ${payment.student.last_name}` : null,
    };

    // A receipt belongs to money taken — an unpaid, overdue or cancelled
    // invoice has no quittance even if an old transaction lingers in its ledger.
    const receiptTransaction = ["paid", "partially_paid"].includes(payment.status)
      ? transactions.find((t) => t.type === "payment")
      : undefined;

    return {
      id: payment.id,
      student_id: payment.student_id,
      group_id: payment.group_id,
      period: payment.period,
      amount_due: toAmount(due),
      paid_amount: payment.paid_amount === null ? null : toAmount(paid),
      due_date: payment.due_date,
      status: payment.status,
      notes: payment.notes,
      paid_at: payment.paid_at,
      remaining_balance: toAmount(round2(due.minus(paid))),
      is_settled: paid.greaterThanOrEqualTo(due),
      receipt_number: receiptTransaction?.receipt_number ?? null,
      student: payment.student,
      group: payment.group,
      transactions,
      context,
    };
  }

  /**
   * One student, one row: the total owed, the total collected and the state of
   * their most urgent invoice — with the exact invoice each action should act
   * on attached, so the row stays a person while the buttons keep their object.
   */
  private presentStudent(invoices: PaymentRow[]) {
    const student = invoices[0]?.student ?? null;
    const sorted = [...invoices].sort(
      (a, b) => b.period.localeCompare(a.period) || b.due_date.getTime() - a.due_date.getTime(),
    );

    let dueTotal = money("0");
    let paidTotal = money("0");
    let status = "cancelled";
    let lastPaidAt: Date | null = null;
    let receiptNumber: string | null = null;
    let receiptPaymentId: string | null = null;
    let lastReceiptPaidAt = 0;

    for (const invoice of invoices) {
      dueTotal = dueTotal.plus(money(invoice.amount_due));
      paidTotal = paidTotal.plus(money(invoice.paid_amount));
      if (STATUS_RANK[invoice.status] < STATUS_RANK[status]) status = invoice.status;
      for (const txn of invoice.paymentTransactions) {
        if (!lastPaidAt || txn.paid_at.getTime() > lastPaidAt.getTime()) lastPaidAt = txn.paid_at;
        const paidPartial = invoice.status === "paid" || invoice.status === "partially_paid";
        if (paidPartial && txn.type === "payment" && txn.paid_at.getTime() > lastReceiptPaidAt) {
          lastReceiptPaidAt = txn.paid_at.getTime();
          receiptNumber = txn.receipt_number;
          receiptPaymentId = invoice.id;
        }
      }
    }

    // The most urgent open invoice is what a cashier will act on; if nothing is
    // open, fall back to the most recent invoice (refunds still live there).
    const unpaid = invoices
      .filter((i) => i.status === "overdue" || i.status === "due_soon" || i.status === "not_paid")
      .sort((a, b) => a.due_date.getTime() - b.due_date.getTime());
    const actionInvoice = unpaid[0] ?? sorted[0];

    const periods = [...new Set(invoices.map((i) => i.period))].sort().reverse();
    const context = {
      ...this.buildContext(sorted.map((i) => i.group), student),
      student_name: student ? `${student.first_name} ${student.last_name}` : null,
    };

    return {
      id: student?.id ?? invoices[0].student_id,
      student_id: invoices[0].student_id,
      view: "student" as const,
      period: periods[0] ?? "",
      periods,
      invoice_count: invoices.length,
      due_date: unpaid[0]?.due_date ?? sorted[0]?.due_date ?? null,
      status,
      amount_due: toAmount(dueTotal),
      paid_amount: toAmount(paidTotal),
      remaining_balance: toAmount(round2(dueTotal.minus(paidTotal))),
      is_settled: paidTotal.greaterThanOrEqualTo(dueTotal),
      receipt_number: receiptNumber,
      receipt_payment_id: receiptPaymentId,
      last_paid_at: lastPaidAt,
      context,
      action_payment_id: actionInvoice?.id ?? null,
      action_payment: actionInvoice ? this.present(actionInvoice) : null,
      // Every matching invoice, so the Manage modal can switch between them.
      payments: invoices.map((invoice) => this.present(invoice)),
    };
  }

  /**
   * The cash-desk ledger: matching invoices grouped per student, sorted and
   * paginated after grouping (a student with a hundred overdue invoices is
   * one row, not a hundred).
   */
  async listStudents(query: PaymentQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where = this.buildWhere(query);

    const [rows, totals] = await Promise.all([
      this.db.client.query.studentPayments.findMany({
        where,
        with: PAYMENT_WITH_FULL,
      }),
      this.db.client
        .select({
          sum_amount_due: sql<string | null>`sum(${studentPayments.amount_due})`,
          sum_paid_amount: sql<string | null>`sum(${studentPayments.paid_amount})`,
        })
        .from(studentPayments)
        .where(where)
        .then((r) => r[0]),
    ]);

    const byStudent = new Map<string, PaymentRow[]>();
    for (const row of rows) {
      const bucket = byStudent.get(row.student_id) ?? [];
      bucket.push(row);
      byStudent.set(row.student_id, bucket);
    }

    const students = [...byStudent.values()].map((invoices) => this.presentStudent(invoices));

    const sortBy = query.sortBy ?? "due_date";
    const sortDir = query.sortDir ?? "desc";
    const dir = sortDir === "asc" ? 1 : -1;
    students.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "period":
          cmp = a.period.localeCompare(b.period);
          break;
        case "amount_due":
          cmp = money(a.amount_due).comparedTo(money(b.amount_due));
          break;
        case "status":
          cmp = STATUS_RANK[a.status] - STATUS_RANK[b.status];
          break;
        case "paid_at":
          cmp = (a.last_paid_at?.getTime() ?? 0) - (b.last_paid_at?.getTime() ?? 0);
          break;
        default:
          cmp = (a.due_date?.getTime() ?? 0) - (b.due_date?.getTime() ?? 0);
      }
      return cmp * dir;
    });

    const total = students.length;
    const paged = students.slice((page - 1) * limit, page * limit);

    return {
      data: paged,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        totals: {
          amount_due: toAmount(money(totals.sum_amount_due)),
          paid_amount: toAmount(money(totals.sum_paid_amount)),
          outstanding: toAmount(
            round2(money(totals.sum_amount_due).minus(money(totals.sum_paid_amount))),
          ),
        },
      },
    };
  }

  private mapTransactions(transactions: TransactionRow[]) {
    return [...transactions]
      .sort((a, b) => a.paid_at.getTime() - b.paid_at.getTime())
      .map((t) => ({
        id: t.id,
        type: t.type,
        amount: toAmount(money(t.amount)),
        professor_share: toAmount(money(t.professor_share)),
        school_share: toAmount(money(t.school_share)),
        receipt_number: t.receipt_number,
        paid_at: t.paid_at,
        recorder: t.user,
      }));
  }

  /**
   * Collects the distinct level/field/professor/group chain of the invoices
   * (and the student's own enrollments) into one deduplicated context, so the
   * ledger UI can show "3rd entity +2 more" instead of repeating a row.
   */
  private buildContext(
    groups: (GroupBrief | null)[],
    student?: { group: GroupBrief | null; assignments?: { group: GroupBrief | null }[] } | null,
  ) {
    const chain = new Map<string, { type: string; id: string; name: string; color: string | null }>();
    const add = (type: string, id: string, name: string, color: string | null) => {
      if (!id) return;
      chain.set(`${type}:${id}`, { type, id, name, color });
    };
    const walk = (
      g?: { id: string; name: string; color: string | null } | null,
      p?: { id: string; full_name: string; color: string | null } | null,
      f?: { id: string; name: string; color: string | null } | null,
      l?: { id: string; name: string; color: string | null } | null,
    ) => {
      add("group", g?.id ?? "", g?.name ?? "", g?.color ?? null);
      add("professor", p?.id ?? "", p?.full_name ?? "", p?.color ?? null);
      add("field", f?.id ?? "", f?.name ?? "", f?.color ?? null);
      add("level", l?.id ?? "", l?.name ?? "", l?.color ?? null);
    };

    for (const g of groups) {
      if (!g) continue;
      const p = g.professor;
      const f = p?.field;
      const l = f?.level;
      walk(g, p, f, l);
    }
    if (student?.group) {
      const p = student.group.professor;
      const f = p?.field;
      const l = f?.level;
      walk(student.group, p, f, l);
    }
    for (const a of student?.assignments ?? []) {
      const g = a.group;
      if (!g) continue;
      const p = g.professor;
      const f = p?.field;
      const l = f?.level;
      walk(g, p, f, l);
    }

    const groupsList = [...chain.values()].filter((c) => c.type === "group");
    const professors = [...chain.values()].filter((c) => c.type === "professor");
    const fields = [...chain.values()].filter((c) => c.type === "field");
    const levels = [...chain.values()].filter((c) => c.type === "level");

    return {
      group: groupsList[0] ?? null,
      professor: professors[0] ?? null,
      field: fields[0] ?? null,
      level: levels[0] ?? null,
      groups: groupsList,
      professors,
      fields,
      levels,
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
      throw new BadRequestException("Le montant du remboursement doit être supérieur à zéro");
    }

    const payment = await this.requirePayment(paymentId);
    const alreadyPaid = money(payment.paid_amount);
    if (amount.greaterThan(alreadyPaid)) {
      throw new BadRequestException(
        `Impossible de rembourser ${toAmount(amount)} — seul ${toAmount(alreadyPaid)} a été encaissé sur cette facture`,
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
      throw new BadRequestException("Une correction de zéro ne change rien");
    }

    const payment = await this.requirePayment(paymentId);
    const resulting = money(payment.paid_amount).plus(delta);
    if (resulting.isNegative()) {
      throw new BadRequestException(
        `Cette correction porterait le total encaissé à ${toAmount(resulting)}, ce qui ne peut pas être négatif`,
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
        "Cette facture est annulée. Rouvrez-la avant d'enregistrer quoi que ce soit.",
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
            ? "Cette facture est déjà réglée en totalité"
            : "Le montant du paiement doit être supérieur à zéro",
        );
      }
      // Overpayment is almost always a keying slip, and letting it through would
      // put the invoice into a state no status describes.
      if (amount.greaterThan(outstanding)) {
        throw new BadRequestException(
          `C'est plus que le solde de ${toAmount(outstanding)} restant sur cette facture`,
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

    const result = await this.db.client.transaction(async (tx) => {
      const receiptNumber = input.issueReceipt
        ? await this.receipts.next(tx, "payment", input.paidAt)
        : null;

      const [transaction] = await tx
        .insert(paymentTransactions)
        .values({
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
          compensationModel: split.model,
          compensation_snapshot: split.snapshot,
          prof_id: profId,
          period: payment.period,
        })
        .returning();

      const updated = await this.reconcile(tx, input.paymentId, input.type);
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
   *
   * A refund that nets the ledger back to zero cancels the invoice: its money
   * is gone, so it must not show up as still owed (`not_paid`) anywhere in the
   * financial section — every figure there already excludes `cancelled`.
   */
  private async reconcile(tx: Tx, paymentId: string, movementType?: TransactionType) {
    const [payment, aggregate, settings] = await Promise.all([
      tx.query.studentPayments.findFirst({
        where: eq(studentPayments.id, paymentId),
        columns: {
          amount_due: true,
          paid_amount: true,
          status: true,
          due_date: true,
          recorded_by: true,
        },
      }),
      tx
        .select({ sum_amount: sql<string | null>`sum(${paymentTransactions.amount})` })
        .from(paymentTransactions)
        .where(eq(paymentTransactions.payment_id, paymentId))
        .then((r) => r[0]),
      this.settings.get(),
    ]);
    if (!payment) throw new NotFoundException(`Paiement ${paymentId} introuvable`);

    const collected = round2(money(aggregate.sum_amount));
    const due = money(payment.amount_due);

    const status: PaymentStatus =
      payment.status === "cancelled"
        ? "cancelled"
        : movementType === "refund" && collected.lessThanOrEqualTo(0)
          ? "cancelled"
          : this.deriveStatus(collected, due, payment.due_date, settings.due_soon_days);

    // The last payment's timestamp is what a receipt and the "paid on" column
    // should show; it is null again the moment the ledger nets back to nothing.
    const lastPaidAt = collected.greaterThan(0)
      ? ((
          await tx
            .select({ paid_at: paymentTransactions.paid_at })
            .from(paymentTransactions)
            .where(and(eq(paymentTransactions.payment_id, paymentId), gt(paymentTransactions.amount, "0")))
            .orderBy(desc(paymentTransactions.paid_at))
            .limit(1)
        )[0]?.paid_at ?? null)
      : null;

    const [updated] = await tx
      .update(studentPayments)
      .set({
        paid_amount: collected.isZero() ? null : collected.toFixed(2),
        status,
        paid_at: lastPaidAt,
        payment_method: collected.greaterThan(0) ? "cash" : null,
        recorded_by: collected.greaterThan(0) ? payment.recorded_by : null,
      })
      .where(eq(studentPayments.id, paymentId))
      .returning();

    return updated;
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
        "Cette facture a déjà un encaissement. Remboursez le montant encaissé avant d'annuler.",
      );
    }
    if (payment.status === "cancelled") {
      throw new BadRequestException("Cette facture est déjà annulée");
    }

    const [updated] = await this.db.client
      .update(studentPayments)
      .set({
        status: "cancelled",
        notes: dto.reason,
      })
      .where(eq(studentPayments.id, paymentId))
      .returning();

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

  /** Puts a cancelled invoice back into circulation as unpaid. */
  async reopen(paymentId: string, userId: string) {
    const payment = await this.requirePayment(paymentId);
    if (payment.status !== "cancelled") {
      throw new BadRequestException("Seule une facture annulée peut être rouverte");
    }

    await this.db.client
      .update(studentPayments)
      .set({ status: "not_paid" })
      .where(eq(studentPayments.id, paymentId));

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
   * Any status can be set — the ledger checks are intentionally waived so the
   * override never bounces on the invoice's own history (marking a zero-cash
   * invoice paid is the front desk's call, and the revenue engine reads
   * transactions, not this badge). Every change is audited with the caller and
   * an optional reason.
   */
  async updateStatus(paymentId: string, userId: string, dto: UpdatePaymentStatusDto) {
    const payment = await this.requirePayment(paymentId);
    const target = dto.status;

    if (payment.status === target) return this.findOne(paymentId);

    const [updated] = await this.db.client
      .update(studentPayments)
      .set({ status: target })
      .where(eq(studentPayments.id, paymentId))
      .returning();

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

  private async requirePayment(paymentId: string): Promise<PaymentRow> {
    const payment = await this.db.client.query.studentPayments.findFirst({
      where: eq(studentPayments.id, paymentId),
      with: PAYMENT_WITH_FULL,
    });
    if (!payment) throw new NotFoundException(`Paiement ${paymentId} introuvable`);
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
   * in a single insert and already-billed periods are skipped, so a whole
   * school of students renews in one call.
   */
  async generateMonthly(months = 0) {
    const count = Math.min(Math.max(Math.floor(months) || 0, 0), 12);
    const today = new Date();

    const activeStudents = await this.db.client.query.students.findMany({
      where: eq(students.status, "active"),
      columns: { id: true, group_id: true, enrollment_date: true, monthly_fee: true },
      with: { assignments: { columns: { group_id: true, fee: true } } },
    });
    if (activeStudents.length === 0) return [];

    const records: {
      student_id: string;
      group_id: string;
      period: string;
      amount_due: string;
      due_date: Date;
      status: PaymentStatus;
    }[] = [];
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
            status: "not_paid",
          });
        }
      }
    }

    if (records.length === 0) return [];
    await this.insertPayments(records);
    return records;
  }

  /**
   * Creates whatever one student still owes, from enrolment through this month,
   * plus `monthsAhead` further months — so a parent paying the term upfront can
   * have every upcoming invoice generated in one click.
   */
  async generateForStudent(studentId: string, monthsAhead = 0) {
    const student = await this.db.client.query.students.findFirst({
      where: eq(students.id, studentId),
      columns: { id: true, group_id: true, enrollment_date: true, monthly_fee: true, status: true },
      with: { assignments: { columns: { group_id: true, fee: true } } },
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

    const billed = await this.db.client.query.studentPayments.findMany({
      where: and(
        eq(studentPayments.student_id, studentId),
        inArray(
          studentPayments.period,
          periods.map((p) => p.period),
        ),
      ),
      columns: { period: true, group_id: true },
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
    await this.insertPayments(records);

    return this.db.client.query.studentPayments.findMany({
      where: and(
        eq(studentPayments.student_id, studentId),
        inArray(
          studentPayments.period,
          records.map((r) => r.period),
        ),
      ),
      orderBy: (p, { asc }) => [asc(p.period)],
    });
  }

  private async insertPayments(
    records: {
      student_id: string;
      group_id: string;
      period: string;
      amount_due: string;
      due_date: Date;
      status: PaymentStatus;
    }[],
  ): Promise<void> {
    if (records.length === 0) return;
    await this.db.client
      .insert(studentPayments)
      .values(records)
      .onConflictDoNothing({
        target: [studentPayments.student_id, studentPayments.group_id, studentPayments.period],
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

    const scope = studentId ? eq(studentPayments.student_id, studentId) : undefined;

    const [expiredSoon, dueSoon, legacyOverdue] = await Promise.all([
      this.db.client
        .update(studentPayments)
        .set({ status: "not_paid" })
        // `lte` rather than `lt`: the due_soon window starts strictly after
        // today, so anything due today or earlier is no longer due soon.
        .where(and(scope, eq(studentPayments.status, "due_soon"), lte(studentPayments.due_date, today)))
        .returning({ id: studentPayments.id }),
      this.db.client
        .update(studentPayments)
        .set({ status: "due_soon" })
        .where(
          and(
            scope,
            eq(studentPayments.status, "not_paid"),
            gt(studentPayments.due_date, today),
            lte(studentPayments.due_date, soon),
          ),
        )
        .returning({ id: studentPayments.id }),
      this.db.client
        .update(studentPayments)
        .set({ status: "not_paid" })
        .where(and(scope, eq(studentPayments.status, "overdue")))
        .returning({ id: studentPayments.id }),
    ]);

    return {
      overdue: legacyOverdue.length,
      dueSoon: dueSoon.length,
      total: expiredSoon.length + dueSoon.length + legacyOverdue.length,
    };
  }
}