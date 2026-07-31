import { z } from "zod";

export const fieldSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export const professorSchema = z.object({
  full_name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional(),
  field_id: z.string().uuid(),
});

export const levelSchema = z.object({
  name: z.string().min(1),
  prof_id: z.string().uuid(),
});

export const groupSchema = z.object({
  name: z.string().min(1),
  level_id: z.string().uuid(),
  capacity: z.coerce.number().optional(),
  schedule_notes: z.string().optional(),
});

export const studentSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  phone: z.string().min(1),
  parent_phone: z.string().optional(),
  email: z.string().email().optional(),
  enrollment_date: z.coerce.date(),
  monthly_fee: z.coerce.number(),
  group_id: z.string().uuid(),
});
