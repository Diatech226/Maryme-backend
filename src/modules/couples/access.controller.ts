import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthUser } from '../../common/types/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CouplesService } from './couples.service';

@ApiTags('Access')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ACCESS_AGENT)
@Controller('access')
export class AccessController {
  constructor(private readonly couples: CouplesService) {}

  @Get('context')
  context(@CurrentUser() user: AuthUser) {
    return this.couples.accessContext(user);
  }
}
