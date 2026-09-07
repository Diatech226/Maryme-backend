import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsOptional } from 'class-validator';

export class CreateInvitationDto {
  @IsOptional() @Type(() => Date) @IsDate() expiresAt?: Date;
  /** Old printed QR codes remain valid unless replacement is explicitly requested. */
  @IsOptional() @IsBoolean() revokePrevious = false;
}
