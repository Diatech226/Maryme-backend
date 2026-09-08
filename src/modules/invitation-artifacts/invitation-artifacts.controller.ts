import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthUser } from '../../common/types/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UploadFile } from '../storage/upload-validation';
import {
  ArtifactFormatDto,
  ArtifactListQueryDto,
  CreateShareLinkDto,
  UploadArtifactDto,
} from './dto/artifact.dto';
import { InvitationArtifactsService } from './invitation-artifacts.service';
@ApiTags('Invitation artifacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.COUPLE)
@Controller()
export class InvitationArtifactsController {
  constructor(private s: InvitationArtifactsService) {}
  @Post('invitations/:invitationId/artifact')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'image', maxCount: 1 },
      { name: 'pdf', maxCount: 1 },
    ]),
  )
  create(
    @Param('invitationId') id: string,
    @Body() dto: UploadArtifactDto,
    @UploadedFiles() files: { image?: UploadFile[]; pdf?: UploadFile[] },
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.create(id, dto.designId, files?.image?.[0], files?.pdf?.[0], u);
  }
  @Get('guests/:guestId/invitation-artifacts') list(
    @Param('guestId') id: string,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.list(id, u);
  }
  @Get('couples/:coupleId/invitation-artifacts') listForCouple(
    @Param('coupleId') id: string,
    @Query() query: ArtifactListQueryDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.listForCouple(id, query, u);
  }
  @Get('invitation-artifacts/:artifactId/download') async download(
    @Param('artifactId') id: string,
    @Query() q: ArtifactFormatDto,
    @CurrentUser() u: AuthUser,
    @Res() res: Response,
  ) {
    const f = await this.s.download(id, q.format, u);
    const extension =
      q.format === 'pdf'
        ? 'pdf'
        : ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[f.contentType] ??
          'bin');
    res.type(f.contentType).attachment(`invitation-${id}.${extension}`).send(f.body);
  }
  @Post('invitation-artifacts/:artifactId/share-link') share(
    @Param('artifactId') id: string,
    @Body() d: CreateShareLinkDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.share(id, d, u);
  }
  @Get('invitation-artifacts/:artifactId/share-links') shareLinks(
    @Param('artifactId') id: string,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.shareLinks(id, u);
  }
  @Post('invitation-share-links/:id/revoke') revoke(
    @Param('id') id: string,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.revoke(id, u);
  }
}
@ApiTags('Public invitation shares')
@Controller('public/invitations/share')
export class PublicInvitationSharesController {
  constructor(private s: InvitationArtifactsService) {}
  @Get(':token') async open(@Param('token') token: string, @Res() res: Response) {
    const f = await this.s.publicOpen(token);
    const extension =
      (
        {
          'application/pdf': 'pdf',
          'image/png': 'png',
          'image/jpeg': 'jpg',
          'image/webp': 'webp',
        } as Record<string, string>
      )[f.contentType] ?? 'bin';
    res
      .type(f.contentType)
      .attachment(`invitation.${extension}`)
      .set('Cache-Control', 'private, no-store')
      .send(f.body);
  }
}
