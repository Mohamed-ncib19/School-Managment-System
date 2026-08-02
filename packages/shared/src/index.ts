export type UserRole = "super_admin";

/**
 * `not_paid` is what the UI labels "pending"; `due_soon` is the nudge applied as
 * the due date approaches. `partially_paid` means the ledger holds less than the
 * amount due, and `cancelled` voids an invoice without deleting it.
 */
export type PaymentStatus =
  | "not_paid"
  | "due_soon"
  | "overdue"
  | "paid"
  | "partially_paid"
  | "cancelled";

export type PaymentMethod = "cash";

export type StudentStatus = "active" | "paused" | "withdrawn";

/** A movement of money against an invoice. Refunds and corrections are new rows, never edits. */
export type TransactionType = "payment" | "refund" | "correction";

/**
 * How a professor's cut is worked out. Everything past `percentage` exists so
 * the arrangement can change without a schema migration — only
 * RevenueCalculationService switches on this value.
 */
export type CompensationModel =
  | "percentage"
  | "fixed_salary"
  | "fixed_per_student"
  | "fixed_per_group"
  | "hybrid"
  | "custom";

/** Derived by comparing earned against paid, never stored. */
export type PayrollStatus = "unpaid" | "partial" | "paid";

/** Bucket size for every time series on the financial dashboard. */
export type Granularity = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

/** The academic dimensions a financial figure can be grouped or filtered by. */
export type FinancialDimension = "level" | "field" | "professor" | "group" | "student";
