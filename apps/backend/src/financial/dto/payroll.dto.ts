import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { compensationModel } from "../../db/schema";

type CompensationModel = (typeof compensationModel.enumValues)[number];

import { COMPENSATION_MODELS } from "./financial-settings.dto";

const AMOUNT = /^\d{1,8}(\.\d{1,2})?$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Records money handed to a professor.
 *
 * `amount` is required and always positive — there is no "pay everything owed"
 * shortcut, because the outstanding balance moves as collections come in and an
 * administrator should be paying a figure they have actually looked at.
 */
export class RecordPayrollDto {
  @ApiProperty({ example: "480.00" })
  @Transform(({ value }) => (value === null || value === undefined ? value : String(value)))
  @Matches(AMOUNT, { message: "amount must be a positive number with at most 2 decimal places" })
  amount!: string;

  @ApiPropertyOptional({ example: "2026-08", description: "Omit for a lump sum against the whole balance" })
  @IsOptional()
  @Matches(PERIOD, { message: "period must look like YYYY-MM" })
  period?: string;

  @ApiPropertyOptional({ example: "2026-08-31T12:00:00.000Z" })
  @IsOptional()
  @IsString()
  paid_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdatePayrollDto {
  @ApiPropertyOptional({ example: "500.00" })
  @IsOptional()
  @Transform(({ value }) => (value === null || value === undefined ? value : String(value)))
  @Matches(AMOUNT, { message: "amount must be a positive number with at most 2 decimal places" })
  amount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Required by the service whenever the amount changes. */
  @ApiPropertyOptional({ example: "Corrected a keying error" })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}

/** Sets or clears one professor's override of the academy split. */
export class UpsertCompensationDto {
  @ApiProperty({ enum: COMPENSATION_MODELS })
  @IsIn(COMPENSATION_MODELS)
  model!: CompensationModel;

  @ApiPropertyOptional({ example: "70.00", description: "0-100; blank inherits the academy default" })
  @IsOptional()
  @Transform(({ value }) => (value === null || value === "" ? null : String(value)))
  @Matches(/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/, {
    message: "percentage must be between 0 and 100 with at most 2 decimal places",
  })
  percentage?: string | null;

  @ApiPropertyOptional({ example: "800.00" })
  @IsOptional()
  @Transform(({ value }) => (value === null || value === "" ? null : String(value)))
  @Matches(AMOUNT, { message: "fixed_amount must be a positive number with at most 2 decimal places" })
  fixed_amount?: string | null;

  @ApiPropertyOptional({ example: "amount * percentage / 100 + fixed" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  custom_formula?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class PayrollQueryDto {
  @ApiPropertyOptional({ example: "2026-08" })
  @IsOptional()
  @Matches(PERIOD, { message: "period must look like YYYY-MM" })
  period?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() levelId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() fieldId?: string;

  @ApiPropertyOptional({ enum: ["unpaid", "partial", "paid"] })
  @IsOptional()
  @IsIn(["unpaid", "partial", "paid"])
  status?: "unpaid" | "partial" | "paid";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
