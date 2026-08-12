import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateTimeSlotDto {
  @ApiProperty({ example: "P1" })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  label!: string;

  @ApiProperty({ minimum: 0, maximum: 6, description: "0=Saturday … 6=Friday (Tunisian school week)" })
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week!: number;

  @ApiProperty({ example: "09:00" })
  @IsString()
  start_time!: string;

  @ApiProperty({ example: "10:30" })
  @IsString()
  end_time!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort_order?: number;
}

export class UpdateTimeSlotDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  label?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week?: number;

  @ApiPropertyOptional({ example: "09:00" })
  @IsOptional()
  @IsString()
  start_time?: string;

  @ApiPropertyOptional({ example: "10:30" })
  @IsOptional()
  @IsString()
  end_time?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort_order?: number;
}

export class ReorderTimeSlotsDto {
  @ApiProperty({ type: [String], description: "Ordered array of time_slot ids" })
  ids!: string[];
}
