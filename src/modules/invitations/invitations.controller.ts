import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthUser } from '../../common/types/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateInvitationDto } from './dto/invitation.dto';
import { InvitationsService } from './invitations.service';
@ApiTags('Invitations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.COUPLE)
@Controller()
export class InvitationsController {
  constructor(private readonly s: InvitationsService) {}
  @Post('guests/:guestId/invitations') create(
    @Param('guestId') id: string,
    @Body() d: CreateInvitationDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.generate(id, d, u);
  }
  @Get('guests/:guestId/invitations') list(
    @Param('guestId') id: string,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.list(id, u);
  }
  @Post('invitations/:id/revoke') revoke(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.revoke(id, u);
  }
}
