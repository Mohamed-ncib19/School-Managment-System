import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateLevelDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "prof_id must be a valid professor id" })
  prof_id!: string;

  @ApiProperty({ example: "Level 1" })
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MinLength(1, { message: "Name is required" })
  @MaxLength(120)
  name!: string;
}

export class UpdateLevelDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MinLength(1, { message: "Name cannot be empty" })
  @MaxLength(120)
  name?: string;
}
