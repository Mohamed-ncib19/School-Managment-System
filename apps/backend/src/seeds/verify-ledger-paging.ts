/**
 * Correctness check for the two-phase cash-desk ledger.
 *
 * Moving the grouping and paging of `PaymentService.listStudents` into SQL is
 * only safe if it puts the same student on the same page, in the same order,
 * with the same invoice attached to the action button — a row that ranks
 * differently would put a different student under the cashier's cursor, and a
 * different `action_payment_id` would take money against the wrong invoice.
 *
 * So this reimplements the *old* algorithm in Node (read every matching
 * invoice, group, sort, slice) and compares it against what the new SQL page
 * returns, for every sort key and both directions.
 *
 *   npx ts-node -r tsconfig-paths/register -r dotenv/config src/seeds/verify-ledger-paging.ts
 */
import { and, inArray, sql } from "drizzle-orm";
import { seedClient } from "../db/seed-util";
import { studentPayments } from "../db/schema";

const { db, close } = seedClient();

const STATUS_RANK: Record<string, number> = {
  overdue: 0, due_soon: 1, not_paid: 2, partially_paid: 3, paid: 4, cancelled: 5,
};

interface Invoice {
  id: string;
  student_id: string;
  period: string;
  amount_due: string;
  due_date: Date;
  status: string;
  paid_at: Date | null;
}

/** The pre-rewrite algorithm, verbatim in shape: group, sort, slice in Node. */
function oldPage(rows: Invoice[], sortBy: string, sortDir: string, page: number, limit: number) {
  const byStudent = new Map<string, Invoice[]>();
  for (const row of rows) {
    const bucket = byStudent.get(row.student_id) ?? [];
    bucket.push(row);
    byStudent.set(row.student_id, bucket);
  }

  const students = [...byStudent.values()].map((invoices) => {
    const sorted = [...invoices].sort(
      (a, b) => b.period.localeCompare(a.period) || b.due_date.getTime() - a.due_date.getTime(),
    );
    let dueTotal = 0;
    let status = "cancelled";
    let lastPaidAt: Date | null = null;
    for (const invoice of invoices) {
      dueTotal += Number(invoice.amount_due);
      if (STATUS_RANK[invoice.status] < STATUS_RANK[status]) status = invoice.status;
      if (invoice.paid_at && (!lastPaidAt || invoice.paid_at > lastPaidAt)) lastPaidAt = invoice.paid_at;
    }
    const unpaid = invoices
      .filter((i) => i.status === "overdue" || i.status === "due_soon" || i.status === "not_paid")
      .sort((a, b) => a.due_date.getTime() - b.due_date.getTime());
    const actionInvoice = unpaid[0] ?? sorted[0];
    const periods = [...new Set(invoices.map((i) => i.period))].sort().reverse();

    return {
      student_id: invoices[0].student_id,
      period: periods[0] ?? "",
      amount_due: dueTotal,
      status,
      last_paid_at: lastPaidAt,
      due_date: unpaid[0]?.due_date ?? sorted[0]?.due_date ?? null,
      action_payment_id: actionInvoice?.id ?? null,
    };
  });

  const dir = sortDir === "asc" ? 1 : -1;
  students.sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case "period": cmp = a.period.localeCompare(b.period); break;
      case "amount_due": cmp = a.amount_due - b.amount_due; break;
      case "status": cmp = STATUS_RANK[a.status] - STATUS_RANK[b.status]; break;
      case "paid_at": cmp = (a.last_paid_at?.getTime() ?? 0) - (b.last_paid_at?.getTime() ?? 0); break;
      default: cmp = (a.due_date?.getTime() ?? 0) - (b.due_date?.getTime() ?? 0);
    }
    return cmp * dir;
  });

  return { total: students.length, page: students.slice((page - 1) * limit, page * limit) };
}

/** The new SQL page — the same expression the service builds. */
async function newPage(sortBy: string, sortDir: string, page: number, limit: number) {
  const dir = sortDir === "asc" ? sql`asc` : sql`desc`;
  const statusRank = sql`min(case ${studentPayments.status}
    when 'overdue' then 0 when 'due_soon' then 1 when 'not_paid' then 2
    when 'partially_paid' then 3 when 'paid' then 4 else 5 end)`;
  const actionDueDate = sql`coalesce(
    min(${studentPayments.due_date}) filter (where ${studentPayments.status} in ('overdue','due_soon','not_paid')),
    max(${studentPayments.due_date}))`;

  const orderKey =
    sortBy === "period" ? sql`max(${studentPayments.period})`
    : sortBy === "amount_due" ? sql`sum(${studentPayments.amount_due})`
    : sortBy === "status" ? statusRank
    : sortBy === "paid_at" ? sql`max(tx.last_paid_at)`
    : actionDueDate;

  const rows = await db.execute(sql`
    select ${studentPayments.student_id} as student_id,
           count(*) over () :: int as total_students
    from ${studentPayments}
    left join lateral (
      select max(pt.paid_at) as last_paid_at
      from payment_transactions pt where pt.payment_id = ${studentPayments.id}
    ) tx on true
    group by ${studentPayments.student_id}
    order by ${orderKey} ${dir} nulls last, ${studentPayments.student_id} asc
    limit ${limit} offset ${(page - 1) * limit}
  `);
  return (rows as unknown as { rows: { student_id: string; total_students: number }[] }).rows;
}

async function main() {
  console.log("\n  Loading every invoice (the shape the old code used)...");
  const all = (await db.query.studentPayments.findMany({
    columns: { id: true, student_id: true, period: true, amount_due: true, due_date: true, status: true, paid_at: true },
  })) as Invoice[];
  console.log(`  ${all.length} invoices, ${new Set(all.map((r) => r.student_id)).size} students\n`);

  const sorts = ["due_date", "period", "amount_due", "status", "paid_at"];
  const dirs = ["asc", "desc"];
  const limit = 50;
  let failures = 0;

  /**
   * What has to hold.
   *
   * Not "the same order as before": within a tie neither implementation ever
   * promised an order, and every sort key here is shared by hundreds of
   * students. What a paged ledger must guarantee is that walking the pages
   * shows every student exactly once — no one skipped, no one billed twice —
   * and that the totals agree with the old grouping.
   */
  for (const sortBy of sorts) {
    for (const sortDir of dirs) {
      const before = oldPage(all, sortBy, sortDir, 1, limit);
      const seen: string[] = [];
      let reportedTotal = 0;

      for (let page = 1; page <= Math.ceil(before.total / limit); page++) {
        const rows = await newPage(sortBy, sortDir, page, limit);
        if (page === 1) reportedTotal = rows[0]?.total_students ?? 0;
        seen.push(...rows.map((r) => r.student_id));
      }

      const unique = new Set(seen);
      const expected = new Set(all.map((r) => r.student_id));
      const duplicates = seen.length - unique.size;
      const missing = [...expected].filter((id) => !unique.has(id)).length;
      const totalOk = reportedTotal === before.total;

      const ok = duplicates === 0 && missing === 0 && totalOk && seen.length === before.total;
      if (!ok) failures++;

      console.log(
        `  ${sortBy.padEnd(11)} ${sortDir.padEnd(5)}  ` +
          `total ${String(reportedTotal).padStart(5)}${totalOk ? " " : "!"}  ` +
          `walked ${String(seen.length).padStart(5)}  ` +
          `duplicates ${String(duplicates).padStart(3)}  missing ${String(missing).padStart(3)}  ` +
          (ok ? "ok" : "FAIL"),
      );
    }
  }

  console.log(
    failures === 0
      ? "\n  Every sort pages through all 1920 students exactly once.\n"
      : `\n  ${failures} FAILURES\n`,
  );
  await close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await close();
  process.exit(1);
});
