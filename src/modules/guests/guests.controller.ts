import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthUser } from '../../common/types/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  BulkCreateGuestsDto,
  CreateGuestDto,
  GuestQueryDto,
  GuestImportDto,
  MarkInvitationsSentDto,
  UpdateGuestDto,
} from './dto/guest.dto';
import { GuestsService } from './guests.service';
@ApiTags('Guests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.COUPLE)
@Controller()
export class GuestsController {
  constructor(private readonly s: GuestsService) {}
  @Get('couples/:coupleId/guests') list(
    @Param('coupleId') id: string,
    @Query() q: GuestQueryDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.list(id, q, u);
  }
  @Post('couples/:coupleId/guests') create(
    @Param('coupleId') id: string,
    @Body() d: CreateGuestDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.create(id, d, u);
  }
  @Post('couples/:coupleId/guests/bulk') bulk(
    @Param('coupleId') id: string,
    @Body() d: BulkCreateGuestsDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.bulk(id, d, u);
  }
  @Post('couples/:coupleId/guests/import') importGuests(
    @Param('coupleId') id: string,
    @Body() d: GuestImportDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.importGuests(id, d, u);
  }
  @Get('guests/:id') get(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.get(id, u);
  }
  @Get('guests/:id/invitation-status') invitationStatus(
    @Param('id') id: string,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.invitationStatus(id, u);
  }
  @Post('guests/:id/invitation-sent') markInvitationSent(
    @Param('id') id: string,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.markInvitationSent(id, u);
  }
  @Post('couples/:coupleId/invitations/mark-sent') markInvitationsSent(
    @Param('coupleId') id: string,
    @Body() dto: MarkInvitationsSentDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.markInvitationsSent(id, dto, u);
  }
  @Patch('guests/:id') update(
    @Param('id') id: string,
    @Body() d: UpdateGuestDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.update(id, d, u);
  }
  @Delete('guests/:id') @HttpCode(204) remove(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.remove(id, u);
  }
}
