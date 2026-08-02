import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from "class-validator";
import { Transform } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { GRANULARITIES, type Granularity } from "../period.util";

export const DIMENSIONS = ["level", "field", "professor", "group", "student"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const QUICK_RANGES = [
  "today",
  "this_week",
  "this_month",
  "last_month",
  "this_year",
  "academic_year",
] as const;

/**
 * The filter shared by the dashboard, the analytics charts and every report.
 *
 * One shape for all three so a figure the administrator sees on a card and the
 * same figure in an exported report are produced by identical filtering — a
 * report that quietly scopes differently from the dashboard it was opened from
 * is worse than no report.
 */
export class FinancialQueryDto {
  @ApiPropertyOptional({ enum: GRANULARITIES, default: "monthly" })
  @IsOptional()
  @IsIn(GRANULARITIES)
  granularity?: Granularity;

  @ApiPropertyOptional({ enum: QUICK_RANGES, description: "Overrides from/to when present" })
  @IsOptional()
  @IsIn(QUICK_RANGES)
  range?: (typeof QUICK_RANGES)[number];

  @ApiPropertyOptional({ example: "2026-01-01" })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: "2026-12-31" })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() levelId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() fieldId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() profId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() groupId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() studentId?: string;

  @ApiPropertyOptional({ example: "2026-08" })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "period must look like YYYY-MM" })
  period?: string;

  /** Which academic dimension to break the figures down by. */
  @ApiPropertyOptional({ enum: DIMENSIONS })
  @IsOptional()
  @IsIn(DIMENSIONS)
  dimension?: Dimension;

  @ApiPropertyOptional({ default: 10, description: "Top-N for ranked breakdowns" })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === "" ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export const REPORT_TYPES = [
  "collections",
  "outstanding",
  "professor_payroll",
  "school_revenue",
  "revenue_by_level",
  "revenue_by_professor",
  "revenue_by_group",
  "revenue_forecast",
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export const EXPORT_FORMATS = ["pdf", "excel", "csv"] as const;

export class ReportQueryDto extends FinancialQueryDto {
  @ApiPropertyOptional({ enum: REPORT_TYPES })
  @IsOptional()
  @IsIn(REPORT_TYPES)
  type?: ReportType;

  @ApiPropertyOptional({ enum: EXPORT_FORMATS })
  @IsOptional()
  @IsIn(EXPORT_FORMATS)
  format?: (typeof EXPORT_FORMATS)[number];
}

/** Filters for the transactions-history screen. */
export class TransactionQueryDto extends FinancialQueryDto {
  @ApiPropertyOptional({ enum: ["payment", "refund", "correction"] })
  @IsOptional()
  @IsIn(["payment", "refund", "correction"])
  type?: "payment" | "refund" | "correction";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
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
  pageLimit?: number;
}
