import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsOptional, IsString } from 'class-validator';
export class UploadArtifactDto {
  @IsString() designId!: string;
}
export class ArtifactFormatDto {
  @IsIn(['image', 'pdf']) format: 'image' | 'pdf' = 'image';
}
export class CreateShareLinkDto {
  @IsOptional() @Type(() => Date) @IsDate() expiresAt?: Date;
}
export class RegenerateInvitationDto {
  @IsOptional() @IsBoolean() revokePrevious = false;
  @IsOptional() @Type(() => Date) @IsDate() expiresAt?: Date;
}
