import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { TUNISIA_PHONE_PATTERN } from "../../common/phone.util";
import { ENTITY_COLOR_PATTERN, ENTITY_COLOR_MESSAGE } from "../../common/color.util";

const PHONE_PATTERN = TUNISIA_PHONE_PATTERN;
const PHONE_MESSAGE = "Phone must be 8 digits with the +216 country code, e.g. +216 22 123 456";

export class CreateProfessorDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID("4", { message: "field_id must be a valid field id" })
  field_id!: string;

  @ApiProperty()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MinLength(1, { message: "Full name is required" })
  @MaxLength(160)
  full_name!: string;

  @ApiProperty()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() || undefined : value))
  @IsEmail({}, { message: "Email address is not valid" })
  email?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Staff login to link to this professor" })
  @IsOptional()
  @IsUUID("4")
  user_id?: string;

  @ApiPropertyOptional({ example: "#4F46E5", description: "Accent color shown on cards and rows" })
  @IsOptional()
  @Matches(ENTITY_COLOR_PATTERN, { message: ENTITY_COLOR_MESSAGE })
  color?: string;
}

export class UpdateProfessorDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @MinLength(1, { message: "Full name cannot be empty" })
  @MaxLength(160)
  full_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() || undefined : value))
  @IsEmail({}, { message: "Email address is not valid" })
  email?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID("4")
  user_id?: string;

  @ApiPropertyOptional({ example: "#4F46E5", description: "Accent color shown on cards and rows" })
  @IsOptional()
  @Matches(ENTITY_COLOR_PATTERN, { message: ENTITY_COLOR_MESSAGE })
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
