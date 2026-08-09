import { IsObject, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateSystemSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  system_name?: string;

  @IsOptional()
  @IsObject()
  features?: Record<string, boolean>;

  /** Support contact shown in the sidebar "Contact support" modal. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  support_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  support_phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  support_whatsapp?: string;
}
