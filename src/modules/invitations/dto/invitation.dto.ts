import { Type } from 'class-transformer'; import { IsDate, IsOptional } from 'class-validator'; export class CreateInvitationDto{@IsOptional() @Type(()=>Date) @IsDate() expiresAt?:Date}
