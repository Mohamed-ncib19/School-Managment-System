import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Matches, Min } from "class-validator";
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

  /**
   * The new window, given directly.
   *
   * A move used to require picking a `new_time_slot_id` from the declared
   * slots, so a session could only be moved to a time somebody had already
   * catalogued. The times are given as themselves and the stored slot is
   * resolved from them; the weekday comes from the target date, so it is not
   * asked for. `new_time_slot_id` still works for existing callers.
   */
  @ApiPropertyOptional({ example: "09:00" })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "new_start_time must be HH:MM" })
  new_start_time?: string;

  @ApiPropertyOptional({ example: "10:30" })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "new_end_time must be HH:MM" })
  new_end_time?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Legacy alternative to new_start_time/new_end_time" })
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

  /** The new window, given directly. See `CreateEntryExceptionDto`. */
  @ApiPropertyOptional({ minimum: 0, maximum: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week?: number;

  @ApiPropertyOptional({ example: "09:00" })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "start_time must be HH:MM" })
  start_time?: string;

  @ApiPropertyOptional({ example: "10:30" })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "end_time must be HH:MM" })
  end_time?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Legacy alternative to start_time/end_time" })
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