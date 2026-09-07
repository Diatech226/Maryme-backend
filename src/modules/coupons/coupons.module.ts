import { Global, Module } from '@nestjs/common';
import { CouponPoolService } from './coupon-pool.service';
import { CouponsController } from './coupons.controller';
@Global()
@Module({
  controllers: [CouponsController],
  providers: [CouponPoolService],
  exports: [CouponPoolService],
})
export class CouponsModule {}
