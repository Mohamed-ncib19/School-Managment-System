import { IsArray, IsBoolean, IsDefined, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class WorkingHourDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 6, nullable: true, description: "0=Saturday … 6=Friday. Omit for the every-day default row." })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week?: number | null;

  @ApiPropertyOptional({ example: "Morning" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string;

  @ApiProperty({ example: "08:00" })
  @IsString()
  @Matches(TIME_PATTERN, { message: "start_time must match HH:MM" })
  start_time!: string;

  @ApiProperty({ example: "12:00" })
  @IsString()
  @Matches(TIME_PATTERN, { message: "end_time must match HH:MM" })
  end_time!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpsertWorkingHoursDto {
  @ApiProperty({ type: [WorkingHourDto], description: "The complete working-hours set — replaces everything previously configured." })
  @IsDefined({ message: "windows is required — send an empty array to clear all working hours" })
  @IsArray()
  @Type(() => WorkingHourDto)
  @ValidateNested({ each: true })
  windows!: WorkingHourDto[];
}