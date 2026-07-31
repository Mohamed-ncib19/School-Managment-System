import { IsEmail, IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

/**
 * Decorators are load-bearing, not documentation: the global ValidationPipe runs
 * with `whitelist: true`, which strips any property that carries no validation
 * decorator. An undecorated DTO arrives empty.
 */
export class LoginDto {
  @ApiProperty({ example: "admin@iqacademy.com" })
  @IsEmail({}, { message: "Invalid email" })
  email!: string;

  @ApiProperty({ example: "admin123" })
  @IsString()
  @IsNotEmpty({ message: "Password is required" })
  password!: string;
}
