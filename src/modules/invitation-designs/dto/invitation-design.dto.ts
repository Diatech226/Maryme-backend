import { InvitationDesignMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
export class OverlayItemDto {
  @IsBoolean() enabled!: boolean;
  @IsNumber() @Min(0) @Max(1) x!: number;
  @IsNumber() @Min(0) @Max(1) y!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) width?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) height?: number;
}
export class OverlayConfigDto {
  @IsOptional() @ValidateNested() @Type(() => OverlayItemDto) qr?: OverlayItemDto;
  @IsOptional() @ValidateNested() @Type(() => OverlayItemDto) guestName?: OverlayItemDto;
  @IsOptional() @ValidateNested() @Type(() => OverlayItemDto) family?: OverlayItemDto;
  @IsOptional() @ValidateNested() @Type(() => OverlayItemDto) category?: OverlayItemDto;
  @IsOptional() @ValidateNested() @Type(() => OverlayItemDto) table?: OverlayItemDto;
  @IsOptional() @ValidateNested() @Type(() => OverlayItemDto) coupons?: OverlayItemDto;
  @IsOptional() @ValidateNested() @Type(() => OverlayItemDto) assignedSeats?: OverlayItemDto;
}
export class ContentConfigDto {
  @IsOptional() @IsBoolean() guestName?: boolean;
  @IsOptional() @IsBoolean() family?: boolean;
  @IsOptional() @IsBoolean() category?: boolean;
  @IsOptional() @IsBoolean() tableNumber?: boolean;
  @IsOptional() @IsBoolean() couponNumbers?: boolean;
  @IsOptional() @IsBoolean() assignedSeats?: boolean;
  @IsOptional() @IsBoolean() qr?: boolean;
}
export class CreateInvitationDesignDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsEnum(InvitationDesignMode) mode!: InvitationDesignMode;
  @IsOptional() @IsString() @IsNotEmpty() templateKey?: string;
  @IsOptional() @IsInt() @Min(1) canvasWidth?: number;
  @IsOptional() @IsInt() @Min(1) canvasHeight?: number;
  @ValidateNested() @Type(() => OverlayConfigDto) overlayConfig!: OverlayConfigDto;
  @IsOptional() @ValidateNested() @Type(() => ContentConfigDto) contentConfig?: ContentConfigDto;
}
export class UpdateInvitationDesignDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(InvitationDesignMode) mode?: InvitationDesignMode;
  @IsOptional() @IsString() templateKey?: string;
  @IsOptional() @IsInt() @Min(1) canvasWidth?: number;
  @IsOptional() @IsInt() @Min(1) canvasHeight?: number;
  @IsOptional() @ValidateNested() @Type(() => OverlayConfigDto) overlayConfig?: OverlayConfigDto;
  @IsOptional() @ValidateNested() @Type(() => ContentConfigDto) contentConfig?: ContentConfigDto;
}
