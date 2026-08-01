import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/** Digits, spaces and the usual separators - permissive enough for any locale. */
const PHONE_PATTERN = /^[+()\d][\d\s\-().]{4,24}$/;

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
  @Matches(PHONE_PATTERN, { message: "Phone number is not valid" })
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
  @Matches(PHONE_PATTERN, { message: "Phone number is not valid" })
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
