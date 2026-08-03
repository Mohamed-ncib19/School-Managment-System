import { IsObject, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateSystemSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  system_name?: string;

  @IsOptional()
  @IsObject()
  features?: Record<string, boolean>;
}
