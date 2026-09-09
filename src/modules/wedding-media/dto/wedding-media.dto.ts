import { BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class UploadWeddingMediaDto {
  @Transform(({ value }) => weddingMediaSlot(value))
  @IsInt()
  @Min(1)
  @Max(3)
  slot!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label!: string;
}

export class UpdateWeddingMediaDto {
  @IsOptional()
  @Transform(({ value }) => weddingMediaSlot(value))
  @IsInt()
  @Min(1)
  @Max(3)
  slot?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label?: string;
}

function weddingMediaSlot(value: unknown): number {
  const slot = Number(value);
  if (!Number.isInteger(slot) || slot < 1 || slot > 3)
    throw new BadRequestException({
      code: 'WEDDING_MEDIA_SLOT_INVALID',
      message: 'Wedding media slot must be 1, 2, or 3',
    });
  return slot;
}
