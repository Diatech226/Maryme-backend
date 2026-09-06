import { DietaryRequirement, GuestCategory, GuestSide, RsvpStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
} from 'class-validator';
export class CreateGuestDto {
  @IsString() firstName!: string;
  @IsString() lastName!: string;
  @IsEnum(GuestSide) side!: GuestSide;
  @IsOptional() @IsString() family?: string;
  @IsInt() @Min(1) @Max(20) coupons!: number;
  @IsEnum(GuestCategory) category!: GuestCategory;
  @IsOptional() @IsEnum(RsvpStatus) rsvpStatus?: RsvpStatus;
  @IsOptional() @IsEnum(DietaryRequirement) dietary?: DietaryRequirement;
  @IsOptional() @IsBoolean() plusOne?: boolean;
  @IsOptional() @IsString() plusOneName?: string;
  @IsOptional() @IsBoolean() isChild?: boolean;
  @IsOptional() @IsString() tableNumber?: string;
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
  @IsOptional() @IsEnum(GuestCategory) category?: GuestCategory;
  @IsOptional() @IsEnum(RsvpStatus) rsvpStatus?: RsvpStatus;
  @IsOptional() @IsEnum(DietaryRequirement) dietary?: DietaryRequirement;
  @IsOptional() @IsBoolean() plusOne?: boolean;
  @IsOptional() @IsString() plusOneName?: string;
  @IsOptional() @IsBoolean() isChild?: boolean;
  @IsOptional() @IsString() tableNumber?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) assignedSeats?: string[];
  @IsOptional() @IsString() notes?: string;
}
export enum BulkGuestsMode {
  APPEND = 'append',
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
export class GuestQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
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
}
