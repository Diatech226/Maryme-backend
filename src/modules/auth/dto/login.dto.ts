import { IsEmail, IsString, MinLength } from 'class-validator';
export const PASSWORD_MIN_LENGTH = 12;
export class LoginDto { @IsEmail() email!: string; @IsString() @MinLength(PASSWORD_MIN_LENGTH) password!: string; }
