import { Type } from 'class-transformer';
import {
  IsInt,
  Matches,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
export class ValidateCheckInDto {
  @IsString() @MinLength(32) token!: string;
}
export class CreateCheckInDto extends ValidateCheckInDto {
  @IsOptional() @IsString() @MaxLength(128) @Matches(/^[\p{L}\p{N}._: -]+$/u) deviceId?: string;
}
export class CheckInQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}
