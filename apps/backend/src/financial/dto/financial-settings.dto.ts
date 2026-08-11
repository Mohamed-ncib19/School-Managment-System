import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { Transform } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import type { compensationModel } from "../../db/schema";

type CompensationModel = (typeof compensationModel.enumValues)[number];

export const COMPENSATION_MODELS = [
  "percentage",
  "fixed_salary",
  "fixed_per_student",
  "fixed_per_group",
  "hybrid",
  "custom",
] as const;

/**
 * The global ValidationPipe runs with `whitelist: true`, which strips any
 * property carrying no validation decorator â€” an undecorated field silently
 * never arrives.
 */
export class UpdateFinancialSettingsDto {
  @ApiPropertyOptional({ example: "School Management System" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  academy_name?: string;

  @ApiPropertyOptional({ example: "12 Rue de la LibertÃ©, Tunis" })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  academy_address?: string;

  @ApiPropertyOptional({ example: "+216 71 000 000" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  academy_phone?: string;

  @ApiPropertyOptional({ example: "TND" })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ example: "fr-TN" })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  currency_locale?: string;

  @ApiPropertyOptional({ enum: COMPENSATION_MODELS })
  @IsOptional()
  @IsIn(COMPENSATION_MODELS)
  default_compensation_model?: CompensationModel;

  /**
   * Kept as a string so the decimal never round-trips through a float.
   */
  @ApiPropertyOptional({ example: "60.00", description: "0-100" })
  @IsOptional()
  @Transform(({ value }) => (value === null || value === undefined ? value : String(value)))
  @Matches(/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/, {
    message: "default_professor_percentage must be between 0 and 100 with at most 2 decimal places",
  })
  default_professor_percentage?: string;

  @ApiPropertyOptional({ example: "800.00", nullable: true })
  @IsOptional()
  @Transform(({ value }) => (value === null || value === "" ? null : String(value)))
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: "default_fixed_amount must be a positive number with at most 2 decimal places",
  })
  default_fixed_amount?: string | null;

  @ApiPropertyOptional({ example: "REC-{YYYY}-{SEQ}" })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(/\{SEQ(:\d+)?\}/, {
    message: "receipt_number_format must contain {SEQ}, or receipts would not be unique",
  })
  receipt_number_format?: string;

  @ApiPropertyOptional({ example: "PAY-{YYYY}-{SEQ}" })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(/\{SEQ(:\d+)?\}/, {
    message: "payroll_receipt_format must contain {SEQ}, or receipts would not be unique",
  })
  payroll_receipt_format?: string;

  @ApiPropertyOptional({ example: "SET-{YYYY}-{SEQ}" })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(/\{SEQ(:\d+)?\}/, {
    message: "settlement_receipt_format must contain {SEQ}, or references would not be unique",
  })
  settlement_receipt_format?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Transform(({ value }) => (value === null || value === undefined ? value : Number(value)))
  @IsInt()
  @Min(0)
  @Max(31)
  due_soon_days?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Transform(({ value }) => (value === null || value === undefined ? value : Number(value)))
  @IsInt()
  @Min(0)
  @Max(90)
  late_grace_days?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  late_fee_enabled?: boolean;

  @ApiPropertyOptional({ example: "10.00", nullable: true })
  @IsOptional()
  @Transform(({ value }) => (value === null || value === "" ? null : String(value)))
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message: "late_fee_amount must be a positive number with at most 2 decimal places",
  })
  late_fee_amount?: string | null;

  @ApiPropertyOptional({ example: 9, description: "1-12; September starts the 2026/27 year" })
  @IsOptional()
  @Transform(({ value }) => (value === null || value === undefined ? value : Number(value)))
  @IsInt()
  @Min(1)
  @Max(12)
  academic_year_start_month?: number;

  /**
   * Not persisted. A formula sent here is parse-checked and rejected if broken,
   * so the settings screen can validate before anyone relies on it.
   */
  @ApiPropertyOptional({ example: "amount * percentage / 100" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  custom_formula_check?: string;
}
