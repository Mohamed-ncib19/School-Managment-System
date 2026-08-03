import { IsArray, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
import { Transform, Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * A generated monthly attendance sheet to persist.
 *
 * The academic context is snapshotted (teacher/group/level names and the
 * student roster), because a reprint must show the list that was actually
 * handed out, not whatever the hierarchy looks like today.
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

  @ApiProperty()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MaxLength(200)
  group_name!: string;

  @ApiProperty({ type: [Object] })
  @IsArray()
  students!: unknown[];
}
