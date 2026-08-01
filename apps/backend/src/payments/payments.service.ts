import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentStatus } from "@iq/shared";
import { billingPeriods, dueDateFor, periodOf } from "./billing.util";

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async recordPayment(
    paymentId: string,
    userId: string,
    dto: { paid_amount?: string; notes?: string },
  ) {
    const payment = await this.prisma.student_payments.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        student_id: true,
        status: true,
        amount_due: true,
        period: true,
        paid_amount: true,
        paid_at: true,
      },
    });
    if (!payment) {
      throw new NotFoundException(`Payment record ${paymentId} not found`);
    }

    const amountDue = payment.amount_due.toString();
    const paidAmount = dto.paid_amount ?? amountDue;

    const updated = await this.prisma.student_payments.update({
      where: { id: paymentId },
      data: {
        status: "paid" as PaymentStatus,
        paid_at: new Date(),
        paid_amount: paidAmount,
        recorded_by: userId,
        payment_method: "cash",
        ...(dto.notes !== undefined && { notes: dto.notes || null }),
      },
    });

    await this.auditService.record({
      action: "payment.recorded",
      entityType: "student_payment",
      entityId: paymentId,
      entityLabel: `${payment.period} - ${paidAmount}`,
      actorId: userId,
      prevValues: { status: payment.status, paid_amount: payment.paid_amount, paid_at: payment.paid_at },
      newValues: { status: "paid", paid_amount: paidAmount, payment_method: "cash" },
      meta: { amount_due: amountDue, student_id: payment.student_id, period: payment.period },
    });

    return updated;
  }

  async getPayments(filters: {
    status?: string;
    groupId?: string;
    levelId?: string;
    profId?: string;
    fieldId?: string;
  }) {
    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.groupId) {
      where.student = { group_id: filters.groupId };
    } else if (filters.levelId) {
      where.student = { group: { level_id: filters.levelId } };
    } else if (filters.profId) {
      where.student = { group: { level: { prof_id: filters.profId } } };
    } else if (filters.fieldId) {
      where.student = { group: { level: { professor: { field_id: filters.fieldId } } } };
    }

    return this.prisma.student_payments.findMany({
      where,
      include: { student: true },
      orderBy: { due_date: "desc" },
    });
  }

  async getPaymentHistory(studentId: string) {
    return this.prisma.student_payments.findMany({
      where: { student_id: studentId },
      orderBy: { period: "desc" },
    });
  }

  /**
   * Bills every active student for the month ahead. Students enrolled part-way
   * through get their own months from `generatePaymentForStudent`, so this only
   * has to cover the recurring run.
   */
  async generateMonthlyPayments() {
    // Via Date.UTC so December rolls into January of the next year rather than
    // producing a month index of 12.
    const today = new Date();
    const nextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    const year = nextMonth.getUTCFullYear();
    const month = nextMonth.getUTCMonth();
    const period = periodOf(year, month);

    const activeStudents = await this.prisma.students.findMany({
      where: { status: "active" },
      select: { id: true, enrollment_date: true, monthly_fee: true },
    });

    if (activeStudents.length === 0) return [];

    const billed = await this.prisma.student_payments.findMany({
      where: { period, student_id: { in: activeStudents.map((s) => s.id) } },
      select: { student_id: true },
    });
    const alreadyBilled = new Set(billed.map((p) => p.student_id));

    const records = activeStudents
      .filter((student) => !alreadyBilled.has(student.id))
      .map((student) => ({
        student_id: student.id,
        period,
        // `monthly_fee` is a Decimal; Prisma takes the string directly, so the
        // amount never round-trips through a float.
        amount_due: student.monthly_fee.toString(),
        due_date: dueDateFor(student.enrollment_date, year, month),
        status: "not_paid" as PaymentStatus,
      }));

    if (records.length === 0) return [];

    await this.prisma.student_payments.createMany({ data: records, skipDuplicates: true });
    return records;
  }

  /**
   * Creates whatever a single student still owes, from the month they enrolled
   * through the current month.
   *
   * This used to bill `today + 1 month` and nothing else, which meant the month
   * a student actually enrolled in was never invoiced — the UI calls this the
   * moment a student is created, so every student joined one month free.
   * Working forward from `enrollment_date` also lets a student imported with a
   * back-dated enrolment pick up the months they missed.
   */
  async generatePaymentForStudent(studentId: string) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: { id: true, enrollment_date: true, monthly_fee: true, status: true },
    });
    if (!student || student.status !== "active") return [];

    const periods = billingPeriods(student.enrollment_date, new Date());
    if (periods.length === 0) return [];

    const billed = await this.prisma.student_payments.findMany({
      where: { student_id: studentId, period: { in: periods.map((p) => p.period) } },
      select: { period: true },
    });
    const alreadyBilled = new Set(billed.map((p) => p.period));

    const records = periods
      .filter((p) => !alreadyBilled.has(p.period))
      .map((p) => ({
        student_id: student.id,
        period: p.period,
        amount_due: student.monthly_fee.toString(),
        due_date: dueDateFor(student.enrollment_date, p.year, p.month),
        status: "not_paid" as PaymentStatus,
      }));

    if (records.length === 0) return [];

    await this.prisma.student_payments.createMany({ data: records, skipDuplicates: true });
    return this.prisma.student_payments.findMany({
      where: { student_id: studentId, period: { in: records.map((r) => r.period) } },
      orderBy: { period: "asc" },
    });
  }

  /**
   * Rolls pending rows forward: anything past its due date becomes overdue,
   * anything due within two days becomes due_soon. Two set-based updates rather
   * than reading every pending row and issuing an UPDATE per record.
   */
  async updatePaymentStatuses() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueSoonCutoff = new Date(today);
    dueSoonCutoff.setDate(dueSoonCutoff.getDate() + 2);

    const overdue = await this.prisma.student_payments.updateMany({
      where: { status: { in: ["not_paid", "due_soon"] }, due_date: { lt: today } },
      data: { status: "overdue" },
    });

    const dueSoon = await this.prisma.student_payments.updateMany({
      where: { status: "not_paid", due_date: { gte: today, lte: dueSoonCutoff } },
      data: { status: "due_soon" },
    });

    return { overdue: overdue.count, dueSoon: dueSoon.count, total: overdue.count + dueSoon.count };
  }

  async generateReceipt(paymentId: string): Promise<string> {
    const payment = await this.prisma.student_payments.findUnique({
      where: { id: paymentId },
      include: {
        student: {
          include: {
            group: {
              include: {
                level: {
                  include: {
                    professor: {
                      include: {
                        field: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException(`Payment record ${paymentId} not found`);
    }

    const student = payment.student;
    const group = student.group;
    const level = group?.level;
    const professor = level?.professor;
    const field = professor?.field;

    const formatCurrency = (amount: number) =>
      new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(amount);

    const formatDate = (date: Date | null) =>
      date
        ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date)
        : "—";

    const labels = {
      receiptId: "Numéro de quittance",
      studentName: "Étudiant",
      phone: "Téléphone",
      field: "Filière",
      professor: "Professeur",
      level: "Niveau",
      group: "Groupe",
      period: "Période",
      dueDate: "Date d'échéance",
      status: "Statut",
      datePaid: "Date de paiement",
      paymentMethod: "Méthode de paiement",
      amountPaid: "Montant payé",
    };

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quittance de Paiement - IQ Academy</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
    .receipt { max-width: 600px; margin: 0 auto; border: 1px solid #ddd; padding: 30px; }
    .header { text-align: center; border-bottom: 2px solid #264EBE; padding-bottom: 20px; margin-bottom: 20px; }
    .header h1 { color: #264EBE; font-size: 24px; margin-bottom: 5px; }
    .header p { color: #666; font-size: 14px; }
    .receipt-title { text-align: center; font-size: 18px; font-weight: bold; margin-bottom: 20px; color: #264EBE; }
    .details { margin-bottom: 20px; }
    .details table { width: 100%; border-collapse: collapse; }
    .details td { padding: 8px 0; border-bottom: 1px solid #eee; }
    .details td:first-child { font-weight: bold; width: 40%; color: #555; }
    .details td:last-child { color: #333; }
    .amount-due { text-align: center; margin: 25px 0; padding: 15px; background: #f0f4ff; border-radius: 8px; }
    .amount-due .label { font-size: 14px; color: #666; margin-bottom: 5px; }
    .amount-due .value { font-size: 28px; font-weight: bold; color: #264EBE; }
    .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #999; }
    @media print {
      body { padding: 20px; }
      .receipt { border: none; }
    }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <h1>IQ Academy</h1>
      <p>Reçu de Paiement</p>
    </div>
    <div class="receipt-title">Quittance de Paiement</div>
    <div class="details">
      <table>
        <tr><td>${labels.receiptId}</td><td>${payment.id.slice(0, 8).toUpperCase()}</td></tr>
        <tr><td>${labels.studentName}</td><td>${student.first_name} ${student.last_name}</td></tr>
        <tr><td>${labels.phone}</td><td>${student.phone}</td></tr>
        <tr><td>${labels.field}</td><td>${field?.name ?? "—"}</td></tr>
        <tr><td>${labels.professor}</td><td>${professor?.full_name ?? "—"}</td></tr>
        <tr><td>${labels.level}</td><td>${level?.name ?? "—"}</td></tr>
        <tr><td>${labels.group}</td><td>${group?.name ?? "—"}</td></tr>
        <tr><td>${labels.period}</td><td>${payment.period}</td></tr>
        <tr><td>${labels.dueDate}</td><td>${formatDate(payment.due_date)}</td></tr>
        <tr><td>${labels.status}</td><td>${payment.status.replace(/_/g, " ").toUpperCase()}</td></tr>
        ${payment.paid_at ? `<tr><td>${labels.datePaid}</td><td>${formatDate(payment.paid_at)}</td></tr>` : ""}
        ${payment.payment_method ? `<tr><td>${labels.paymentMethod}</td><td>${payment.payment_method}</td></tr>` : ""}
      </table>
    </div>
    <div class="amount-due">
      <div class="label">${labels.amountPaid}</div>
      <div class="value">${formatCurrency(payment.paid_amount != null ? Number(payment.paid_amount) : Number(payment.amount_due))}</div>
    </div>
    <div class="footer">
      <p>IQ Academy &mdash; Merci pour votre paiement.</p>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Moves a row between the unpaid states. `paid` is not reachable here — see
   * UpdatePaymentStatusDto — because marking a row paid has to capture who took
   * the cash and when, which only `recordPayment` does.
   */
  async updatePaymentStatus(
    paymentId: string,
    userId: string,
    status: Exclude<PaymentStatus, "paid">,
  ) {
    const payment = await this.prisma.student_payments.findUnique({
      where: { id: paymentId },
      select: { id: true, student_id: true, status: true, period: true },
    });
    if (!payment) {
      throw new NotFoundException(`Payment record ${paymentId} not found`);
    }

    const updated = await this.prisma.student_payments.update({
      where: { id: paymentId },
      data: {
        status,
        // Reversing a payment has to clear the settlement columns too, or the
        // row reads as unpaid while still carrying an amount and a collector.
        ...(payment.status === "paid" && {
          paid_at: null,
          paid_amount: null,
          recorded_by: null,
          payment_method: null,
        }),
      },
    });

    await this.auditService.record({
      action: "payment.status_changed",
      entityType: "student_payment",
      entityId: paymentId,
      entityLabel: payment.period,
      actorId: userId,
      prevValues: { status: payment.status },
      newValues: { status },
      meta: {
        student_id: payment.student_id,
        // `status` can never be "paid" here, so moving off a paid row is always
        // a reversal - record that the settlement columns were cleared.
        settlement_cleared: payment.status === "paid",
      },
    });

    return updated;
  }
}
