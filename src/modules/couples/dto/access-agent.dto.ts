import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { COUPLE_PASSWORD_MIN_LENGTH } from '../../auth/password-policy.constants';

export class CreateAccessAgentDto {
  @IsEmail() email!: string;
  @IsString() phone!: string;
  @IsString() @MinLength(COUPLE_PASSWORD_MIN_LENGTH) password!: string;
  @IsString() @MaxLength(100) name!: string;
}

export class UpdateAccessAgentDto {
  @IsBoolean() @IsOptional() isActive?: boolean;
}
