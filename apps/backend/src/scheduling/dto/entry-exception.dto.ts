import { IsIn, IsOptional, IsString, IsUUID, MaxLength, Matches } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ScheduleEntryExceptionType } from "../types";

export const ENTRY_EXCEPTION_TYPES = ["cancelled", "moved", "substitute_prof", "room_change"] as const;

export class CreateEntryExceptionDto {
  @ApiProperty({ enum: ENTRY_EXCEPTION_TYPES })
  @IsIn(ENTRY_EXCEPTION_TYPES)
  exception_type!: ScheduleEntryExceptionType;

  @ApiProperty({ example: "2026-10-05" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "occurrence_date must be YYYY-MM-DD" })
  occurrence_date!: string;

  @ApiPropertyOptional({ example: "2026-10-07", description: "Required for `moved`" })
  @IsOptional()
  @IsString()
  new_date?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Required for `moved`" })
  @IsOptional()
  @IsUUID("4")
  new_time_slot_id?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Used by `moved` / `room_change`" })
  @IsOptional()
  @IsUUID("4")
  new_classroom_id?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Used by `moved` / `substitute_prof`" })
  @IsOptional()
  @IsUUID("4")
  new_prof_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ListEntryExceptionsDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  scheduleEntryId?: string;

  @ApiPropertyOptional({ example: "2026-09-01" })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: "2026-09-30" })
  @IsOptional()
  @IsString()
  to?: string;
}

export class SplitScheduleEntryDto {
  @ApiProperty({ example: "2026-10-05", description: "First date of the new rules in the series." })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "from_date must be YYYY-MM-DD" })
  from_date!: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  time_slot_id?: string;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID("4")
  classroom_id?: string | null;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  prof_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  subject?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ example: "2027-06-30", nullable: true })
  @IsOptional()
  @IsString()
  effective_until?: string | null;
}

export class OccurrenceFiltersDto {
  @ApiProperty({ example: "2026-09-01" })
  @IsString()
  from!: string;

  @ApiProperty({ example: "2026-09-30" })
  @IsString()
  to!: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  groupId?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  profId?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  classroomId?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  fieldId?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  levelId?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  studentId?: string;

  @ApiPropertyOptional({ description: "Matches group name, professor name, or a student's name." })
  @IsOptional()
  @IsString()
  search?: string;
}