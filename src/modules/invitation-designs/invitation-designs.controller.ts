import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthUser } from '../../common/types/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UploadFile } from '../storage/upload-validation';
import { CreateInvitationDesignDto, UpdateInvitationDesignDto } from './dto/invitation-design.dto';
import { InvitationDesignsService } from './invitation-designs.service';
@ApiTags('Invitation designs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.COUPLE)
@Controller('couples/:coupleId/invitation-designs')
export class InvitationDesignsController {
  constructor(private s: InvitationDesignsService) {}
  @Get() list(@Param('coupleId') c: string, @CurrentUser() u: AuthUser) {
    return this.s.list(c, u);
  }
  @Post() create(
    @Param('coupleId') c: string,
    @Body() d: CreateInvitationDesignDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.create(c, d, u);
  }
  @Get(':designId') get(
    @Param('coupleId') c: string,
    @Param('designId') id: string,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.get(c, id, u);
  }
  @Patch(':designId') update(
    @Param('coupleId') c: string,
    @Param('designId') id: string,
    @Body() d: UpdateInvitationDesignDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.update(c, id, d, u);
  }
  @Delete(':designId') remove(
    @Param('coupleId') c: string,
    @Param('designId') id: string,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.remove(c, id, u);
  }
  @Post(':designId/activate') activate(
    @Param('coupleId') c: string,
    @Param('designId') id: string,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.activate(c, id, u);
  }
  @Post(':designId/background')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  background(
    @Param('coupleId') c: string,
    @Param('designId') id: string,
    @UploadedFile() f: UploadFile | undefined,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.background(c, id, f, u);
  }
  @Get(':designId/background')
  async downloadBackground(
    @Param('coupleId') c: string,
    @Param('designId') id: string,
    @CurrentUser() u: AuthUser,
    @Res() res: Response,
  ) {
    const file = await this.s.downloadBackground(c, id, u);
    res
      .type(file.contentType)
      .set('Cache-Control', 'private, no-store')
      .set('X-Content-Type-Options', 'nosniff')
      .send(file.body);
  }
}
