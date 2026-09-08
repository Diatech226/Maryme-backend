import { GuestSide } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
  ValidateIf,
} from 'class-validator';

export class CreateWeddingTableDto {
  @Type(() => Number) @IsInt() @Min(1) number!: number;
  @IsEnum(GuestSide) side!: GuestSide;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) capacity?: number;
}
export class UpdateWeddingTableDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) number?: number;
  @IsOptional() @IsEnum(GuestSide) side?: GuestSide;
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number | null;
}
export class BulkWeddingTablesDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CreateWeddingTableDto)
  tables!: CreateWeddingTableDto[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) defaultCapacity?: number;
  @IsOptional() @IsBoolean() replace?: boolean;
}
export class TableSideConfigurationDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(1000) count!: number;
  @IsArray() @ArrayMaxSize(1000) @IsInt({ each: true }) @Min(1, { each: true }) numbers!: number[];
}
export class ConfigureWeddingTablesDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  groomTableNumbers?: number[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  brideTableNumbers?: number[];
  @IsOptional()
  @ValidateNested()
  @Type(() => TableSideConfigurationDto)
  groomTables?: TableSideConfigurationDto;
  @IsOptional()
  @ValidateNested()
  @Type(() => TableSideConfigurationDto)
  brideTables?: TableSideConfigurationDto;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) defaultCapacity?: number;
  @IsOptional() @IsBoolean() replace = true;
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
  @IsDefined()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  tableId!: string | null;
  @IsOptional() @IsBoolean() allowSideOverride?: boolean;
}
