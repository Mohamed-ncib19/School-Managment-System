import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * ValidationPipe only validates when the parameter type is a decorated class.
 * With an inline TypeScript type the emitted metadata is `Object`, so both
 * validation and `whitelist` stripping were silently skipped - a name sent as a
 * number reached Prisma and surfaced as HTTP 500 instead of a clean 400.
 */
export class CreateFieldDto {
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
}

export class UpdateFieldDto {
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
}
