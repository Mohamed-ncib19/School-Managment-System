import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { Transform } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { PaymentStatus } from "@prisma/client";

const AMOUNT = /^\d{1,8}(\.\d{1,2})?$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export const PAYMENT_STATUSES = [
  "not_paid",
  "due_soon",
  "overdue",
  "paid",
  "partially_paid",
  "cancelled",
] as const;

/**
 * Takes cash against an invoice.
 *
 * `amount` is optional: omitting it settles whatever is still outstanding, which
 * is the overwhelmingly common case at the front desk. Supplying less records a
 * partial payment; the invoice can then be topped up by recording another.
 */
export class RecordTransactionDto {
  @ApiPropertyOptional({ example: "50.00", description: "Defaults to the full outstanding balance" })
  @IsOptional()
  @Transform(({ value }) => (value === null || value === undefined ? value : String(value)))
  @Matches(AMOUNT, { message: "amount must be a positive number with at most 2 decimal places" })
  amount?: string;

  @ApiPropertyOptional({ example: "2026-08-01T10:00:00.000Z" })
  @IsOptional()
  @IsString()
  paid_at?: string;

  @ApiPropertyOptional({ example: "Paid in cash at the front desk" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** Gives money back. Always a new signed row — the original is never edited. */
export class RefundTransactionDto {
  @ApiProperty({ example: "50.00" })
  @Transform(({ value }) => (value === null || value === undefined ? value : String(value)))
  @Matches(AMOUNT, { message: "amount must be a positive number with at most 2 decimal places" })
  amount!: string;

  /** Required: a refund with no stated reason is unauditable. */
  @ApiProperty({ example: "Student withdrew mid-month" })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/**
 * Adjusts a mis-keyed collection.
 *
 * `amount` is the signed delta, so "recorded 100 but it was 80" is -20. Framing
 * it as a delta rather than a replacement keeps the ledger append-only: the
 * original row stays exactly as it was recorded.
 */
export class CorrectTransactionDto {
  @ApiProperty({ example: "-20.00", description: "Signed adjustment" })
  @Transform(({ value }) => (value === null || value === undefined ? value : String(value)))
  @Matches(/^-?\d{1,8}(\.\d{1,2})?$/, {
    message: "amount must be a number with at most 2 decimal places",
  })
  amount!: string;

  @ApiProperty({ example: "Cashier keyed 100 instead of 80" })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CancelPaymentDto {
  @ApiProperty({ example: "Student withdrew before the month started" })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

/** The manual statuses an admin can set. `overdue` is never set — it is not a state. */
export const MANUAL_PAYMENT_STATUSES = [
  "not_paid",
  "due_soon",
  "paid",
  "partially_paid",
  "cancelled",
] as const;

/**
 * Admin override of an invoice's status.
 *
 * Money-bearing states (`paid`, `partially_paid`, `cancelled`) are validated
 * against the ledger in the service so an invoice never shows a status its own
 * history cannot support — marking it paid without the cash would contradict
 * the revenue engine, which only reads transactions.
 */
export class UpdatePaymentStatusDto {
  @ApiProperty({ enum: MANUAL_PAYMENT_STATUSES })
  @IsIn(MANUAL_PAYMENT_STATUSES)
  status!: PaymentStatus;

  @ApiPropertyOptional({ example: "Office override" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * Everything the student-payments screen can filter by.
 *
 * Query strings arrive as strings, so numeric fields are transformed rather than
 * declared as numbers.
 */
export class PaymentQueryDto {
  @ApiPropertyOptional({ enum: PAYMENT_STATUSES })
  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  status?: PaymentStatus;

  @ApiPropertyOptional() @IsOptional() @IsUUID() levelId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() fieldId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() profId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() groupId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() studentId?: string;

  @ApiPropertyOptional({ example: "2026-08" })
  @IsOptional()
  @Matches(PERIOD, { message: "period must look like YYYY-MM" })
  period?: string;

  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === "" ? undefined : Number(value)))
  @IsInt()
  @Min(2000)
  @Max(2200)
  year?: number;

  /** Filters on due date, matching what the list column shows. */
  @ApiPropertyOptional({ example: "2026-08-01" })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: "2026-08-31" })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ example: "REC-2026-0001" })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  receiptNumber?: string;

  @ApiPropertyOptional({ enum: ["cash"] })
  @IsOptional()
  @IsIn(["cash"])
  method?: "cash";

  /** Free text across student name and receipt number. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === "" ? 1 : Number(value)))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === "" ? 50 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({ enum: ["due_date", "period", "amount_due", "status"] })
  @IsOptional()
  @IsIn(["due_date", "period", "amount_due", "status"])
  sortBy?: "due_date" | "period" | "amount_due" | "status";

  @ApiPropertyOptional({ enum: ["asc", "desc"] })
  @IsOptional()
  @IsIn(["asc", "desc"])
  sortDir?: "asc" | "desc";
}
