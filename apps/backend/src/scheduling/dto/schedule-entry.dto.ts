import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/** `HH:MM`, 24-hour. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = "Time must be HH:MM (24-hour)";

export class CreateScheduleEntryDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4")
  group_id!: string;

  /**
   * The window, given directly.
   *
   * A session used to be created by naming a `time_slot_id` from a catalogue an
   * administrator had to curate first, which meant a session could only be put
   * at a time someone had already declared. The times are now given as
   * themselves and the stored slot is resolved (or created) from them.
   *
   * `time_slot_id` is still accepted so existing callers keep working; when
   * both are supplied the explicit times win.
   */
  @ApiPropertyOptional({ minimum: 0, maximum: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week?: number;

  @ApiPropertyOptional({ example: "09:00" })
  @IsOptional()
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  start_time?: string;

  @ApiPropertyOptional({ example: "10:30" })
  @IsOptional()
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  end_time?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  time_slot_id?: string;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID("4")
  classroom_id?: string | null;

  @ApiProperty({ format: "uuid" })
  @IsUUID("4")
  prof_id!: string;

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

  /**
   * When the rule starts. Optional — defaults to today.
   *
   * The session form no longer asks for a period: a weekly rule runs from now
   * until it is deliberately ended, and ending it is the calendar's
   * "Terminer la série". Requiring two dates up front turned every new session
   * into a decision about a term boundary the operator did not have in mind.
   *
   * The column itself stays: `effective_from` is `NOT NULL`, sits in all three
   * unique indexes that stop a double-booking, and is what bounds a rule when
   * the occurrence engine expands it. It is now filled in rather than asked
   * for — the same thing the weekly timetable builder has always done.
   */
  @ApiPropertyOptional({ example: "2026-09-01", description: "Defaults to today" })
  @IsOptional()
  @IsString()
  effective_from?: string;
}

export class UpdateScheduleEntryDto {
  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID("4")
  classroom_id?: string | null;

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

  @ApiPropertyOptional({ example: "2027-06-30" })
  @IsOptional()
  @IsString()
  effective_until?: string | null;
}

export class TileDto {
  @ApiProperty({ minimum: 0, maximum: 6 })
  @IsInt()
  @Min(0)
  day_of_week!: number;

  @ApiProperty({ example: "09:00" })
  @IsString()
  start_time!: string;

  @ApiProperty({ example: "10:30" })
  @IsString()
  end_time!: string;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID("4")
  classroom_id?: string | null;
}

export class SyncTilesDto {
  @ApiProperty({ type: [TileDto] })
  tiles!: TileDto[];
}

export class PreviewTileDto {
  @ApiProperty({ minimum: 0, maximum: 6 })
  @IsInt()
  @Min(0)
  day_of_week!: number;

  @ApiProperty({ example: "09:00" })
  @IsString()
  start_time!: string;

  @ApiProperty({ example: "10:30" })
  @IsString()
  end_time!: string;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID("4")
  classroom_id?: string | null;

  @ApiProperty({ format: "uuid" })
  @IsUUID("4")
  prof_id!: string;

  @ApiPropertyOptional({ format: "uuid", description: "Exclude this group's own entries from the conflict scan" })
  @IsOptional()
  @IsUUID("4")
  exclude_group_id?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  time_slot_id?: string;

  @ApiPropertyOptional({ example: "2026-09-01" })
  @IsOptional()
  @IsString()
  effective_from?: string;
}
