import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class AssignSeatingDto {
  @ApiProperty({ example: '66d8f84fb06a707fa0e90411' })
  @IsString()
  tableId!: string;

  @ApiPropertyOptional({ example: [1, 2, 3], minimum: 1, maximum: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(10, { each: true })
  seatNumbers?: number[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  autoAssign?: boolean;
}

export class ManualSeatAssignmentDto {
  @ApiProperty() @IsString() guestId!: string;
  @ApiProperty({ example: [1, 2] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(10, { each: true })
  seatNumbers!: number[];
}

export class BulkSeatingDto {
  @ApiPropertyOptional({ example: ['guest1', 'guest2'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  guestIds?: string[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  autoAssign?: boolean;

  @ApiPropertyOptional({ type: [ManualSeatAssignmentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ManualSeatAssignmentDto)
  assignments?: ManualSeatAssignmentDto[];
}
