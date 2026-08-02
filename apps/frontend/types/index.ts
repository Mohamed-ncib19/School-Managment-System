export type PaymentStatus =
  | "not_paid"
  | "due_soon"
  | "overdue"
  | "paid"
  | "partially_paid"
  | "cancelled";
export type UserRole = "super_admin";
export type StudentStatus = "active" | "paused" | "withdrawn";
export type PaymentMethod = "cash";
export type TransactionType = "payment" | "refund" | "correction";
export type PayrollStatus = "unpaid" | "partial" | "paid";
export type PayrollDocumentType = "professor_receipt" | "school_settlement";
export type Granularity = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
export type CompensationModel =
  | "percentage"
  | "fixed_salary"
  | "fixed_per_student"
  | "fixed_per_group"
  | "hybrid"
  | "custom";

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string; role: UserRole; full_name: string };
}

export interface Field {
  id: string;
  level_id: string;
  name: string;
  description: string | null;
  color: string | null;
  created_by: string;
  created_at: string;
  level?: Level;
  /** Lightweight preview of the field's active professors (id + name). */
  professors?: { id: string; full_name: string }[];
  _count?: { fields?: number; professors?: number; groups?: number; students?: number };
}

export interface Professor {
  id: string;
  field_id: string;
  full_name: string;
  phone: string;
  email: string | null;
  color: string | null;
  user_id: string | null;
  is_active: boolean;
  created_at: string;
  field?: Field;
  /** Lightweight preview of the professor's active groups (id + name). */
  groups?: { id: string; name: string }[];
  _count?: { fields?: number; professors?: number; groups?: number; students?: number };
}

export interface Level {
  id: string;
  name: string;
  color: string | null;
  is_active: boolean;
  created_at: string;
  _count?: { fields?: number; professors?: number; groups?: number; students?: number };
}

export interface Group {
  id: string;
  prof_id: string;
  name: string;
  capacity: number | null;
  schedule_notes: string | null;
  color: string | null;
  is_active: boolean;
  created_at: string;
  professor?: Professor & { field?: Field };
  /** Lightweight preview of the group's active roster (student names only). */
  assignments?: { student?: { id: string; first_name: string; last_name: string } }[];
  _count?: { fields?: number; professors?: number; groups?: number; students?: number };
}

/** One enrollment row of a student: which group they belong to, its monthly fee, and when it was created. */
export interface StudentAssignment {
  id: string;
  student_id: string;
  group_id: string;
  /** This enrollment's own monthly fee — billing raises one invoice per enrollment. */
  fee: string;
  created_at: string;
  group?: Group & { professor?: Professor & { field?: Field & { level?: Level } } };
}

export interface Student {
  id: string;
  group_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  parent_phone: string | null;
  email: string | null;
  color: string | null;
  enrollment_date: string;
  monthly_fee: number;
  status: StudentStatus;
  created_at: string;
  group?: Group & { professor?: Professor & { field?: Field & { level?: Level } } };
  /** Every enrollment; `group_id` is the primary one and appears in here too. */
  assignments?: StudentAssignment[];
}

/**
 * One movement of money against an invoice.
 *
 * Amounts arrive from the API as decimal strings, never numbers — a float
 * cannot hold 0.1 exactly, and a total assembled in the browser has to agree
 * with the one the database computed.
 */
export interface PaymentTransaction {
  id: string;
  payment_id: string;
  type: TransactionType;
  amount: string;
  method: PaymentMethod;
  receipt_number: string | null;
  paid_at: string;
  notes: string | null;
  reason: string | null;
  professor_share: string;
  school_share: string;
  compensation_model: CompensationModel;
  compensation_snapshot: Record<string, unknown> | null;
  period: string;
  recorder?: { id: string; full_name: string } | null;
}

/** The academic context a payment row needs, resolved server-side. */
export interface PaymentContext {
  student_name: string | null;
  group: { id: string; name: string } | null;
  professor: { id: string; name: string } | null;
  field: { id: string; name: string } | null;
  level: { id: string; name: string } | null;
}

export interface StudentPayment {
  id: string;
  student_id: string;
  /** The enrollment this invoice covers (a multi-group student has one invoice per group per period). */
  group_id: string;
  period: string;
  amount_due: string;
  due_date: string;
  status: PaymentStatus;
  paid_amount: string | null;
  remaining_balance: string;
  is_settled: boolean;
  receipt_number: string | null;
  paid_at: string | null;
  recorded_by: string | null;
  payment_method: PaymentMethod | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  student?: Student;
  transactions: PaymentTransaction[];
  context: PaymentContext;
}

export interface PaymentPage {
  data: StudentPayment[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    totals: { amount_due: string; paid_amount: string; outstanding: string };
  };
}

export interface KpiCard {
  value: string;
  [key: string]: unknown;
}

export interface FinancialDashboard {
  range: { from: string; to: string; granularity: Granularity };
  currency: string;
  cards: {
    total_revenue: KpiCard;
    collected_this_month: KpiCard & { period: string };
    collected_in_range: KpiCard & { count: number };
    pending_payments: KpiCard & { count: number };
    overdue_payments: KpiCard & { count: number };
    professor_payroll: KpiCard & { earned: string; paid: string; paid_in_range: string };
    school_net_revenue: KpiCard & { professor_share: string };
    expected_revenue: KpiCard & { count: number };
    collection_rate: { value: number; collected: string; expected: string };
  };
}

export interface RevenueSeries {
  granularity: Granularity;
  points: {
    bucket: string;
    revenue: string;
    school_share: string;
    professor_share: string;
    transactions: number;
  }[];
}

export interface StatusSlice {
  status: PaymentStatus;
  count: number;
  amount_due: string;
  paid_amount: string;
}

/** A slice of a dimensional breakdown, carrying its own drill-down target. */
export interface BreakdownRow {
  id: string | null;
  name: string;
  revenue: string;
  school_share: string;
  professor_share: string;
  transactions: number;
  drill_to: "level" | "field" | "professor" | "group" | "student" | null;
  drill_filter: Record<string, string> | null;
  [key: string]: unknown;
}

export interface PayrollRow {
  professor: {
    id: string;
    full_name: string;
    phone: string;
    email: string | null;
    is_active: boolean;
    field: { id: string; name: string } | null;
    level: { id: string; name: string } | null;
  };
  period: string;
  model: CompensationModel;
  student_count: number;
  group_count: number;
  earned_from_collections: string;
  earned_fixed: string;
  total_earned: string;
  already_paid: string;
  remaining_balance: string;
  status: PayrollStatus;
}

export interface PayrollList {
  data: PayrollRow[];
  meta: {
    period: string;
    total: number;
    totals?: { earned: string; paid: string; balance: string };
  };
}

export interface PayrollPayment {
  id: string;
  prof_id: string;
  period: string | null;
  amount: string;
  receipt_number: string | null;
  paid_at: string;
  notes: string | null;
  recorder?: { id: string; full_name: string } | null;
}

/**
 * The frozen snapshot behind the printed settlement documents — the professor's
 * payment receipt and the school's internal settlement report. Everything here
 * is what the paper was rendered from; reprinting reads this, never a
 * recomputation under a formula that changed since.
 */
export interface PayrollSettlement {
  document: {
    type: PayrollDocumentType;
    no: string;
    title: string;
    generated_at: string;
  };
  academy: {
    name: string;
    address: string;
    phone: string;
    currency: string;
    currency_locale: string;
  };
  professor: {
    id: string;
    full_name: string;
    phone: string;
    email: string | null;
    level: string | null;
    field: string | null;
  };
  payout: {
    id: string;
    receipt_number: string | null;
    amount: string;
    paid_at: string;
    notes: string | null;
    recorded_by_name: string | null;
  };
  period: { label: string; academic_year: string };
  formula: {
    model: CompensationModel;
    percentage: string | null;
    fixed_amount: string | null;
    custom_formula: string | null;
    is_override: boolean;
    description: string;
  };
  totals: {
    student_count: number;
    group_count: number;
    revenue: string;
    professor_share: string;
    school_share: string;
    earned_from_collections: string;
    earned_fixed: string;
    total_earned: string;
    amount_paid: string;
    remaining_balance: string;
    status: PayrollStatus;
  };
  verification: {
    revenue: string;
    professor_share: string;
    school_share: string;
    verified: boolean;
  };
  groups: {
    group: string;
    students: number;
    revenue: string;
    professor_share: string;
    school_share: string;
  }[];
}

export interface PayrollDocument {
  id: string;
  type: PayrollDocumentType;
  document_no: string;
  title: string;
  period: string | null;
  generated_at: string;
  generated_by: string | null;
  payout_id?: string | null;
  payout_period?: string | null;
  payout_paid_at?: string | null;
}

export interface ProfessorFinancialDetail {
  professor: PayrollRow["professor"] & { created_at: string };
  compensation: {
    model: CompensationModel;
    percentage: string | null;
    fixed_amount: string | null;
    custom_formula: string | null;
    is_override: boolean;
    notes: string | null;
  };
  assignments: {
    id: string;
    name: string;
    capacity: number | null;
    schedule_notes: string | null;
    student_count: number;
  }[];
  student_count: number;
  group_count: number;
  period: {
    label: string;
    revenue_generated: string;
    earned_from_collections: string;
    earned_fixed: string;
    total_earned: string;
    already_paid: string;
    remaining_balance: string;
    status: PayrollStatus;
  };
  lifetime: {
    revenue_generated: string;
    total_earned: string;
    already_paid: string;
    remaining_balance: string;
  };
  monthly_breakdown: { period: string; revenue: string; earned: string; paid: string }[];
  payroll_history: PayrollPayment[];
}

export interface LedgerPage {
  data: (PaymentTransaction & {
    student: { id: string; name: string } | null;
    group: { id: string; name: string } | null;
    professor: { id: string; name: string } | null;
    field: { id: string; name: string } | null;
    level: { id: string; name: string } | null;
    recorded_by: { id: string; name: string } | null;
  })[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    totals: { amount: string; professor_share: string; school_share: string };
  };
}

export interface ReportTable {
  type: string;
  title: string;
  generated_at: string;
  currency: string;
  range: { from: string; to: string };
  columns: { key: string; label: string; align?: "left" | "right"; numeric?: boolean }[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, string | number | null> | null;
  footnotes: string[];
}

export interface FinancialSettings {
  singleton: string;
  academy_name: string;
  academy_address: string;
  academy_phone: string;
  /** Relative path of the uploaded academy logo, when one is set. */
  logo_path: string | null;
  currency: string;
  currency_locale: string;
  default_compensation_model: CompensationModel;
  default_professor_percentage: string;
  default_fixed_amount: string | null;
  receipt_number_format: string;
  payroll_receipt_format: string;
  settlement_receipt_format: string;
  due_soon_days: number;
  late_grace_days: number;
  late_fee_enabled: boolean;
  late_fee_amount: string | null;
  academic_year_start_month: number;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  /** Null for unauthenticated events such as a failed login. */
  actor_user_id: string | null;
  actor_label: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  /** Null for events with no target row (logout, settings changes). */
  entity_id: string | null;
  entity_label: string | null;
  prev_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  meta: any;
  created_at: string;
  actor?: { id: string; full_name: string; email: string; role?: string } | null;
}
