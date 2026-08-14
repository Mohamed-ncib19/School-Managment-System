import { IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ENTITY_COLOR_PATTERN, ENTITY_COLOR_MESSAGE } from "../../common/color.util";

/** `HH:MM`, 24-hour. The wire format every scheduling time field uses. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = "Time must be HH:MM (24-hour)";

export class CreateClassroomDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  floor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  room_number?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  equipment?: string[];

  @ApiPropertyOptional({ example: "#4F46E5" })
  @IsOptional()
  @Matches(ENTITY_COLOR_PATTERN, { message: ENTITY_COLOR_MESSAGE })
  color?: string;
}

/** Query for "which rooms are free on this date, between these times?". */
export class ClassroomAvailabilityQueryDto {
  @ApiProperty({ example: "2026-09-01" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "date must be YYYY-MM-DD" })
  date!: string;

  @ApiProperty({ example: "09:00" })
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  start_time!: string;

  @ApiProperty({ example: "10:30" })
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  end_time!: string;

  /** The group being edited, so its own sessions do not count against it. */
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  excludeGroupId?: string;

  /** The rule being edited, so it does not clash with itself. */
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  excludeEntryId?: string;
}

export class UpdateClassroomDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  floor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  room_number?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  equipment?: string[];

  // `is_active` is deliberately not settable. Archiving a classroom is no
  // longer a thing an operator does — deleting one deletes it — so leaving the
  // field writable would keep a way to produce a hidden room that no screen
  // lists and nothing can restore. The column stays for the rows that exist.

  @ApiPropertyOptional({ example: "#4F46E5" })
  @IsOptional()
  @Matches(ENTITY_COLOR_PATTERN, { message: ENTITY_COLOR_MESSAGE })
  color?: string;
}
