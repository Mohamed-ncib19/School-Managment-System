export type PaymentStatus = "not_paid" | "due_soon" | "overdue" | "paid";
export type UserRole = "super_admin";
export type StudentStatus = "active" | "paused" | "withdrawn";
export type PaymentMethod = "cash";

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
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
}

export interface Professor {
  id: string;
  field_id: string;
  full_name: string;
  phone: string;
  email: string | null;
  user_id: string | null;
  is_active: boolean;
  created_at: string;
  field?: Field;
}

export interface Level {
  id: string;
  prof_id: string;
  name: string;
  created_at: string;
  professor?: Professor;
}

export interface Group {
  id: string;
  level_id: string;
  name: string;
  capacity: number | null;
  schedule_notes: string | null;
  created_at: string;
  level?: Level;
}

export interface Student {
  id: string;
  group_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  parent_phone: string | null;
  email: string | null;
  enrollment_date: string;
  monthly_fee: number;
  status: StudentStatus;
  created_at: string;
  group?: Group & { level?: Level & { professor?: Professor & { field?: Field } } };
}

export interface StudentPayment {
  id: string;
  student_id: string;
  period: string;
  amount_due: number;
  due_date: string;
  status: PaymentStatus;
  paid_amount: number | null;
  paid_at: string | null;
  recorded_by: string | null;
  payment_method: PaymentMethod | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  student?: Student;
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
