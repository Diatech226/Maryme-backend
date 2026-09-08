import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
export class UploadArtifactDto {
  @IsString() designId!: string;
}
export class ArtifactFormatDto {
  @IsIn(['image', 'pdf']) format: 'image' | 'pdf' = 'image';
}
export class CreateShareLinkDto {
  @IsOptional() @Type(() => Date) @IsDate() expiresAt?: Date;
}
export class ArtifactListQueryDto {
  @IsOptional() @IsString() guestId?: string;
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  stale?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}
export class RegenerateInvitationDto {
  @IsOptional() @IsBoolean() revokePrevious = false;
  @IsOptional() @Type(() => Date) @IsDate() expiresAt?: Date;
}
