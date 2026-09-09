import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthUser } from '../../common/types/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UploadFile } from '../storage/upload-validation';
import { UpdateWeddingMediaDto, UploadWeddingMediaDto } from './dto/wedding-media.dto';
import { WeddingMediaService } from './wedding-media.service';

@ApiTags('Wedding media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.COUPLE)
@Controller('couples/:coupleId/wedding-media')
export class WeddingMediaController {
  constructor(private readonly service: WeddingMediaService) {}

  @Get()
  @ApiOperation({ summary: 'List the three shared wedding image slots' })
  list(@Param('coupleId') coupleId: string, @CurrentUser() user: AuthUser) {
    return this.service.list(coupleId, user);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'slot', 'label'],
      properties: {
        file: { type: 'string', format: 'binary' },
        slot: { type: 'integer', minimum: 1, maximum: 3 },
        label: { type: 'string', maxLength: 100 },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'WEDDING_MEDIA_FILE_REQUIRED, WEDDING_MEDIA_SLOT_INVALID, WEDDING_MEDIA_TOO_LARGE, or WEDDING_MEDIA_UNSUPPORTED_TYPE',
  })
  upload(
    @Param('coupleId') coupleId: string,
    @Body() dto: UploadWeddingMediaDto,
    @UploadedFile() file: UploadFile | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.upload(coupleId, dto, file, user);
  }

  @Get(':mediaId/file')
  @ApiNotFoundResponse({ description: 'WEDDING_MEDIA_NOT_FOUND' })
  async download(
    @Param('coupleId') coupleId: string,
    @Param('mediaId') mediaId: string,
    @CurrentUser() user: AuthUser,
    @Res() response: Response,
  ) {
    const file = await this.service.download(coupleId, mediaId, user);
    response
      .type(file.contentType)
      .set('Content-Length', String(file.sizeBytes))
      .set('Cache-Control', 'private, max-age=300')
      .set('X-Content-Type-Options', 'nosniff')
      .send(file.body);
  }

  @Patch(':mediaId')
  @ApiBadRequestResponse({ description: 'WEDDING_MEDIA_SLOT_INVALID' })
  @ApiNotFoundResponse({ description: 'WEDDING_MEDIA_NOT_FOUND' })
  update(
    @Param('coupleId') coupleId: string,
    @Param('mediaId') mediaId: string,
    @Body() dto: UpdateWeddingMediaDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(coupleId, mediaId, dto, user);
  }

  @Delete(':mediaId')
  @HttpCode(204)
  @ApiNotFoundResponse({ description: 'WEDDING_MEDIA_NOT_FOUND' })
  remove(
    @Param('coupleId') coupleId: string,
    @Param('mediaId') mediaId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.remove(coupleId, mediaId, user);
  }
}
