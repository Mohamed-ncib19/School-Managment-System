import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateScheduleEntryDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4")
  group_id!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID("4")
  time_slot_id!: string;

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

  @ApiProperty({ example: "2026-09-01" })
  @IsString()
  effective_from!: string;

  @ApiPropertyOptional({ example: "2027-06-30" })
  @IsOptional()
  @IsString()
  effective_until?: string | null;
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
