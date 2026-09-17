import type { Money } from "./money.util";

/** Every status an invoice can carry (mirrors the `payment_status` enum). */
export type InvoiceStatus =
  | "not_paid"
  | "due_soon"
  | "overdue"
  | "paid"
  | "partially_paid"
  | "cancelled";

/**
 * The one definition of what an invoice's status means, as a pure function so
 * it can be unit-tested without a database.
 *
 * Ordered most-settled first: a fully paid invoice is never also overdue, and
 * a partially paid one stays `partially_paid` past its due date rather than
 * losing the fact that money came in. Unpaid invoices are `due_soon` in the
 * last `dueSoonDays` before the due date — strictly after today, so an
 * invoice due today is plain `not_paid`, as is a just-created one — and
 * there is no `overdue` state, a late invoice is simply unpaid.
 */
export function deriveInvoiceStatus(
  collected: Money,
  due: Money,
  dueDate: Date,
  dueSoonDays: number,
): InvoiceStatus {
  if (collected.greaterThanOrEqualTo(due) && due.greaterThan(0)) return "paid";
  if (collected.greaterThan(0)) return "partially_paid";

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const soon = new Date(today);
  soon.setUTCDate(soon.getUTCDate() + dueSoonDays);
  if (dueDate > today && dueDate <= soon) return "due_soon";

  return "not_paid";
}
