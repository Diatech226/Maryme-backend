import { CouponStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
export class AssignCouponsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  couponNumbers!: number[];
}
export class ReconcileCouponsDto {
  @IsOptional() @IsBoolean() autoAssignMissing = false;
}
export class CouponQueryDto {
  @IsOptional() @IsEnum(CouponStatus) status?: CouponStatus;
  @IsOptional() @IsString() guestId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) number?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}
