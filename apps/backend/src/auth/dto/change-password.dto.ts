import { IsNotEmpty, IsString, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

/**
 * The change-password body was previously typed as a plain object literal on
 * the handler. The global `ValidationPipe` only validates class metatypes, so
 * that body reached the service entirely unchecked: an empty string was
 * accepted and hashed, and the minimum length the setup wizard enforces at
 * install time could be dropped the first time the password was changed.
 *
 * `MIN_PASSWORD_LENGTH` is the wizard's rule (see installer/engine/setup.ps1),
 * restated here so the two cannot drift apart silently. It was raised from 8
 * to 12 in the 2026-09 security audit: this password unlocks the account that
 * can export every student record and financial history the school holds, and
 * its only other protection is a 10-per-minute login throttle.
 */
export const MIN_PASSWORD_LENGTH = 12;

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: "Le mot de passe actuel est requis" })
  current_password!: string;

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH })
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Le nouveau mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`,
  })
  new_password!: string;
}
