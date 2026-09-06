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
import { CoupleStatus, UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthUser } from '../../common/types/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CouplesService } from './couples.service';
import {
  CoupleQueryDto,
  CreateCoupleDto,
  ResetCouplePasswordDto,
  UpdateCoupleAccountDto,
  UpdateCoupleDto,
} from './dto/couple.dto';

@ApiTags('Couples')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('couples')
export class CouplesController {
  constructor(private readonly service: CouplesService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  list(@Query() query: CoupleQueryDto) {
    return this.service.list(query);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  create(@Body() dto: CreateCoupleDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get('me')
  @Roles(UserRole.COUPLE)
  me(@CurrentUser() user: AuthUser) {
    return this.service.get(user.coupleId!, user);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.get(id, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCoupleDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/account')
  @Roles(UserRole.SUPER_ADMIN)
  updateAccount(
    @Param('id') id: string,
    @Body() dto: UpdateCoupleAccountDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateAccount(id, dto, user);
  }

  @Post(':id/reset-password')
  @Roles(UserRole.SUPER_ADMIN)
  resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetCouplePasswordDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.resetPassword(id, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }

  @Post(':id/authorize')
  @Roles(UserRole.SUPER_ADMIN)
  authorize(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.status(id, CoupleStatus.AUTHORIZED, user);
  }

  @Post(':id/suspend')
  @Roles(UserRole.SUPER_ADMIN)
  suspend(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.status(id, CoupleStatus.SUSPENDED, user);
  }
}
