import { IsString, MinLength, IsEmail } from "class-validator";

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  full_name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}
