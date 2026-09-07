import { CoupleStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { COUPLE_PASSWORD_MIN_LENGTH } from '../../auth/password-policy.constants';
export class CreateCoupleDto {
  @IsString() partner1!: string;
  @IsString() partner2!: string;
  @Type(() => Date) @IsDate() weddingDate!: Date;
  @IsString() location!: string;
  @IsEmail() email!: string;
  @IsString() phone!: string;
  @IsInt() @Min(1) @Max(10000) guestQuota!: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() partner1FullName?: string;
  @IsOptional() @IsString() partner2FullName?: string;
  @IsEmail({}, { message: 'Email, téléphone et mot de passe du compte sont obligatoires.' })
  accountEmail!: string;
  @IsString({ message: 'Email, téléphone et mot de passe du compte sont obligatoires.' })
  accountPhone!: string;
  @IsString({ message: 'Email, téléphone et mot de passe du compte sont obligatoires.' })
  @MinLength(COUPLE_PASSWORD_MIN_LENGTH)
  accountPassword!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) groomFamilies?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) brideFamilies?: string[];
  @IsOptional() @Type(() => Date) @IsDate() accessOpensAt?: Date;
  @IsOptional() @Type(() => Date) @IsDate() accessClosesAt?: Date;
}
export class UpdateCoupleDto {
  @IsOptional() @IsString() partner1?: string;
  @IsOptional() @IsString() partner2?: string;
  @IsOptional() @Type(() => Date) @IsDate() weddingDate?: Date;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsInt() @Min(1) guestQuota?: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() bibleVerse?: string;
  @IsOptional() @IsString() lunchVenue?: string;
  @IsOptional() @IsString() lunchTime?: string;
  @IsOptional() @IsString() churchVenue?: string;
  @IsOptional() @IsString() churchTime?: string;
  @IsOptional() @IsString() cityHallVenue?: string;
  @IsOptional() @IsString() cityHallTime?: string;
  @IsOptional() @IsString() partner1FullName?: string;
  @IsOptional() @IsString() partner2FullName?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) groomFamilies?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) brideFamilies?: string[];
  @IsOptional() @IsString() invitationIntroText?: string;
  @IsOptional() @IsString() invitationFooterText?: string;
  @IsOptional() @IsString() dressCode?: string;
  @IsOptional() @IsString() rsvpMessage?: string;
  @IsOptional() @Type(() => Date) @IsDate() accessOpensAt?: Date;
  @IsOptional() @Type(() => Date) @IsDate() accessClosesAt?: Date;
}
export class CoupleQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsEnum(CoupleStatus) status?: CoupleStatus;
  @IsOptional() @IsString() search?: string;
}

export class ResetCouplePasswordDto {
  @IsString()
  @MinLength(COUPLE_PASSWORD_MIN_LENGTH)
  password!: string;
}

export class UpdateCoupleAccountDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
