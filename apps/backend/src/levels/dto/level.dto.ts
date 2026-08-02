import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ENTITY_COLOR_PATTERN, ENTITY_COLOR_MESSAGE } from "../../common/color.util";

/** A level is the top of the hierarchy - it has no parent to reference. */
export class CreateLevelDto {
  @ApiProperty({ example: "Level 1" })
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MinLength(1, { message: "Name is required" })
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: "#4F46E5", description: "Accent color shown on cards and rows" })
  @IsOptional()
  @Matches(ENTITY_COLOR_PATTERN, { message: ENTITY_COLOR_MESSAGE })
  color?: string;
}

export class UpdateLevelDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MinLength(1, { message: "Name cannot be empty" })
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: "#4F46E5", description: "Accent color shown on cards and rows" })
  @IsOptional()
  @Matches(ENTITY_COLOR_PATTERN, { message: ENTITY_COLOR_MESSAGE })
  color?: string;
}
