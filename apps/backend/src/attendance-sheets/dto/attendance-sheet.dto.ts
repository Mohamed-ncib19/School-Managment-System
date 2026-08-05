import { IsArray, IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { Transform, Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/** One teaching session of the register, in order (index + 1 = séance number). */
class AttendanceSessionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  id!: string;

  @ApiPropertyOptional({ example: "2026-04-04", description: "Reserved for future academies that track séance dates." })
  @IsOptional()
  @IsDateString()
  date?: string;
}

/**
 * A generated monthly attendance sheet to persist.
 *
 * The academic context is snapshotted (professor/level/field/group names, the
 * sessions and the student roster), because a reprint must show the list that
 * was actually handed out, not whatever the hierarchy looks like today.
 */
export class SaveAttendanceSheetDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "group_id must be a valid group id" })
  group_id!: string;

  @ApiProperty({ minimum: 1, maximum: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @ApiProperty({ minimum: 2000 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  year!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MaxLength(2000)
  schedule?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4", { message: "teacher_id must be a valid professor id" })
  teacher_id?: string;

  @ApiProperty()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MaxLength(200)
  teacher_name!: string;

  @ApiProperty()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MaxLength(200)
  level_name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MaxLength(200)
  field_name?: string;

  @ApiProperty()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MaxLength(200)
  group_name!: string;

  @ApiPropertyOptional({ example: "2025/26" })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MaxLength(20)
  academic_year?: string;

  @ApiPropertyOptional({ type: [AttendanceSessionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttendanceSessionDto)
  sessions?: AttendanceSessionDto[];

  @ApiProperty({ type: [Object] })
  @IsArray()
  students!: unknown[];
}

/** Asks the generation service to lay out the sessions for a month. */
export class GenerateAttendanceSheetDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "group_id must be a valid group id" })
  group_id!: string;

  @ApiProperty({ minimum: 1, maximum: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @ApiProperty({ minimum: 2000 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  year!: number;

  /** How many séances the month should aim for; defaults to 8. */
  @ApiPropertyOptional({ minimum: 1, maximum: 31 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  sessions_count?: number;
}
