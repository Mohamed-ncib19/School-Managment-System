import { z } from "zod";

export const LoginResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    role: z.string(),
    full_name: z.string(),
  }),
});

export const AuthMeSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  full_name: z.string(),
  role: z.string(),
  is_active: z.boolean(),
});

export const StudentSchema = z.object({
  id: z.string(),
  group_id: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  phone: z.string(),
  parent_phone: z.string().nullable(),
  email: z.string().nullable(),
  color: z.string().nullable(),
  enrollment_date: z.string(),
  monthly_fee: z.number(),
  status: z.string(),
  created_at: z.string(),
});

export const PaymentTransactionSchema = z.object({
  id: z.string(),
  payment_id: z.string(),
  type: z.string(),
  amount: z.string(),
  method: z.string(),
  receipt_number: z.string().nullable(),
  paid_at: z.string(),
  notes: z.string().nullable(),
  reason: z.string().nullable(),
  professor_share: z.string(),
  school_share: z.string(),
  compensation_model: z.string(),
  compensation_snapshot: z.any().nullable(),
  period: z.string(),
});

export const FinancialDashboardSchema = z.object({
  range: z.object({ from: z.string(), to: z.string(), granularity: z.string() }),
  currency: z.string(),
  cards: z.object({
    total_revenue: z.object({ value: z.string() }),
    collected_this_month: z.object({ value: z.string(), period: z.string() }),
    collected_in_range: z.object({ value: z.string(), count: z.number() }),
    pending_payments: z.object({ value: z.string(), count: z.number() }),
    overdue_payments: z.object({ value: z.string(), count: z.number() }),
    professor_payroll: z.object({ value: z.string(), earned: z.string(), paid: z.string(), paid_in_range: z.string() }),
    school_net_revenue: z.object({ value: z.string(), professor_share: z.string() }),
    expected_revenue: z.object({ value: z.string(), count: z.number() }),
    collection_rate: z.object({ value: z.number(), collected: z.string(), expected: z.string() }),
  }),
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type AuthMe = z.infer<typeof AuthMeSchema>;
export type Student = z.infer<typeof StudentSchema>;
export type PaymentTransaction = z.infer<typeof PaymentTransactionSchema>;
export type FinancialDashboard = z.infer<typeof FinancialDashboardSchema>;
