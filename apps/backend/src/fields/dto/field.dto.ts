import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ENTITY_COLOR_PATTERN, ENTITY_COLOR_MESSAGE } from "../../common/color.util";

/**
 * ValidationPipe only validates when the parameter type is a decorated class.
 * With an inline TypeScript type the emitted metadata is `Object`, so both
 * validation and `whitelist` stripping were silently skipped - a name sent as a
 * number reached Prisma and surfaced as HTTP 500 instead of a clean 400.
 */
export class CreateFieldDto {
  @ApiProperty({ format: "uuid", description: "Level this field belongs to" })
  @IsUUID("4", { message: "level_id must be a valid level id" })
  level_id!: string;

  @ApiProperty({ example: "Mathematics" })
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MinLength(1, { message: "Name is required" })
  @MaxLength(120, { message: "Name must be 120 characters or fewer" })
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: "#4F46E5", description: "Accent color shown on cards and rows" })
  @IsOptional()
  @Matches(ENTITY_COLOR_PATTERN, { message: ENTITY_COLOR_MESSAGE })
  color?: string;
}

export class UpdateFieldDto {
  @ApiPropertyOptional({ format: "uuid", description: "Move the field to another level" })
  @IsOptional()
  @IsUUID("4", { message: "level_id must be a valid level id" })
  level_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MinLength(1, { message: "Name cannot be empty" })
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: "#4F46E5", description: "Accent color shown on cards and rows" })
  @IsOptional()
  @Matches(ENTITY_COLOR_PATTERN, { message: ENTITY_COLOR_MESSAGE })
  color?: string;
}
