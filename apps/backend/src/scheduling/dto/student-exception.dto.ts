import { IsEnum, IsOptional, IsString } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export type ExceptionType = "substitute" | "cancelled" | "makeup";

export class CreateExceptionDto {
  @ApiProperty({ enum: ["substitute", "cancelled", "makeup"] })
  @IsEnum(["substitute", "cancelled", "makeup"] as const)
  exception_type!: ExceptionType;

  @ApiProperty({ example: "2026-09-01" })
  @IsString()
  exception_date!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
