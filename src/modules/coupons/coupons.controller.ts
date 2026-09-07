import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthUser } from '../../common/types/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CouponPoolService } from './coupon-pool.service';
import { AssignCouponsDto, CouponQueryDto, ReconcileCouponsDto } from './dto/coupon.dto';
@ApiTags('Coupons')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.COUPLE)
@Controller()
export class CouponsController {
  constructor(private readonly coupons: CouponPoolService) {}
  @Put('guests/:guestId/coupons')
  @ApiOperation({ summary: 'Replace numbered coupon assignment' })
  assign(
    @Param('guestId') id: string,
    @Body() dto: AssignCouponsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.coupons.manuallyAssign(id, dto.couponNumbers, user);
  }
  @Get('couples/:coupleId/coupons/summary') summary(
    @Param('coupleId') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.coupons.summary(id, user);
  }
  @Get('couples/:coupleId/coupons') list(
    @Param('coupleId') id: string,
    @Query() q: CouponQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.coupons.list(id, q, user);
  }
  @Post('couples/:coupleId/coupons/reconcile') reconcile(
    @Param('coupleId') id: string,
    @Body() dto: ReconcileCouponsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.coupons.reconcile(id, dto.autoAssignMissing, user);
  }
}
