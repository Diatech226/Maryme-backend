import { GuestSide } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateWeddingTableDto {
  @Type(() => Number) @IsInt() @Min(1) number!: number;
  @IsEnum(GuestSide) side!: GuestSide;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) capacity?: number;
}
export class UpdateWeddingTableDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) number?: number;
  @IsOptional() @IsEnum(GuestSide) side?: GuestSide;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) capacity?: number;
}
export class BulkWeddingTablesDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CreateWeddingTableDto)
  tables!: CreateWeddingTableDto[];
}
export class TableGenerationRuleDto {
  @Type(() => Number) @IsInt() @Min(1) from!: number;
  @Type(() => Number) @IsInt() @Min(1) to!: number;
  @IsOptional() @IsEnum(GuestSide) side?: GuestSide;
  @IsOptional() @IsEnum(GuestSide) oddSide?: GuestSide;
  @IsOptional() @IsEnum(GuestSide) evenSide?: GuestSide;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) capacity?: number;
}
export class GenerateWeddingTablesDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000) totalTables!: number;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TableGenerationRuleDto)
  rules!: TableGenerationRuleDto[];
  @IsOptional() @IsBoolean() replace?: boolean;
}
export class AssignGuestTableDto {
  @IsOptional() tableId?: string;
  @IsOptional() @IsBoolean() allowSideOverride?: boolean;
}
