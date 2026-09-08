import { DietaryRequirement, GuestCategory, GuestSide, RsvpStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
export class CreateGuestDto {
  @IsString() firstName!: string;
  @IsString() lastName!: string;
  @IsEnum(GuestSide) side!: GuestSide;
  @IsOptional() @IsString() family?: string;
  @IsInt() @Min(1) @Max(20) coupons!: number;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  couponNumbers?: number[];
  @IsEnum(GuestCategory) category!: GuestCategory;
  @IsOptional() @IsEnum(RsvpStatus) rsvpStatus?: RsvpStatus;
  @IsOptional() @IsEnum(DietaryRequirement) dietary?: DietaryRequirement;
  @IsOptional() @IsBoolean() plusOne?: boolean;
  @IsOptional() @IsString() plusOneName?: string;
  @IsOptional() @IsBoolean() isChild?: boolean;
  @IsOptional() @ValidateIf((_o, value) => value !== null) @IsString() tableId?: string | null;
  /** @deprecated Use tableId. Retained for existing clients. */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tableNumber?: number | null;
  @IsOptional() @IsArray() @IsString({ each: true }) assignedSeats?: string[];
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsBoolean() lodgingNeeded?: boolean;
  @IsOptional() @IsString() notes?: string;
}
export class UpdateGuestDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsEnum(GuestSide) side?: GuestSide;
  @IsOptional() @IsString() family?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) coupons?: number;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  couponNumbers?: number[];
  @IsOptional() @IsEnum(GuestCategory) category?: GuestCategory;
  @IsOptional() @IsEnum(RsvpStatus) rsvpStatus?: RsvpStatus;
  @IsOptional() @IsEnum(DietaryRequirement) dietary?: DietaryRequirement;
  @IsOptional() @IsBoolean() plusOne?: boolean;
  @IsOptional() @IsString() plusOneName?: string;
  @IsOptional() @IsBoolean() isChild?: boolean;
  @IsOptional() @ValidateIf((_o, value) => value !== null) @IsString() tableId?: string | null;
  /** @deprecated Use tableId. */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tableNumber?: number | null;
  @IsOptional() @IsArray() @IsString({ each: true }) assignedSeats?: string[];
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsBoolean() lodgingNeeded?: boolean;
}
export enum BulkGuestsMode {
  APPEND = 'append',
  MERGE = 'merge',
  REPLACE = 'replace',
}
export class BulkCreateGuestsDto {
  @IsEnum(BulkGuestsMode) mode: BulkGuestsMode = BulkGuestsMode.APPEND;
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CreateGuestDto)
  guests!: CreateGuestDto[];
}
export class ImportGuestRowDto {
  @IsOptional() @IsString() guestId?: string;
  @IsOptional() @IsString() externalRef?: string;
  @IsString() firstName!: string;
  @IsString() lastName!: string;
  @IsEnum(GuestSide) side!: GuestSide;
  @IsOptional() @IsString() family?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) coupons?: number;
  @IsOptional() @IsArray() @ArrayUnique() @IsInt({ each: true }) couponNumbers?: number[];
  @IsOptional() @IsEnum(GuestCategory) category?: GuestCategory;
  @IsOptional() @IsEnum(RsvpStatus) rsvpStatus?: RsvpStatus;
  @IsOptional() @IsEnum(DietaryRequirement) dietary?: DietaryRequirement;
  @IsOptional() @IsBoolean() plusOne?: boolean;
  @IsOptional() @IsString() plusOneName?: string;
  @IsOptional() @IsBoolean() isChild?: boolean;
  @IsOptional() @IsString() tableId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) tableNumber?: number;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsBoolean() lodgingNeeded?: boolean;
  @IsOptional() @IsString() notes?: string;
}
export class GuestImportDto {
  @IsEnum(BulkGuestsMode) mode: BulkGuestsMode = BulkGuestsMode.MERGE;
  @IsOptional() @IsBoolean() dryRun = false;
  @IsOptional() @IsBoolean() autoAssignCoupons = true;
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ImportGuestRowDto)
  guests!: ImportGuestRowDto[];
}
export class GuestQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit = 50;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsEnum(GuestSide) side?: GuestSide;
  @IsOptional() @IsString() family?: string;
  @IsOptional() @IsEnum(GuestCategory) category?: GuestCategory;
  @IsOptional() @IsEnum(RsvpStatus) rsvpStatus?: RsvpStatus;
  @IsOptional() @IsString() tableNumber?: string;
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' || value === true
      ? true
      : value === 'false' || value === false
        ? false
        : value,
  )
  @IsBoolean()
  checkedIn?: boolean;
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' || value === true
      ? true
      : value === 'false' || value === false
        ? false
        : value,
  )
  @IsBoolean()
  hasPhone?: boolean;
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' || value === true
      ? true
      : value === 'false' || value === false
        ? false
        : value,
  )
  @IsBoolean()
  invitationSent?: boolean;
}

export class MarkInvitationsSentDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  guestIds!: string[];
}
