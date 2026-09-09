import { Module } from '@nestjs/common';
import { GuestsController } from './guests.controller';
import { GuestsService } from './guests.service';
import { SeatingController } from './seating.controller';
import { SeatingService } from './seating.service';

@Module({
  controllers: [GuestsController, SeatingController],
  providers: [GuestsService, SeatingService],
  exports: [GuestsService, SeatingService],
})
export class GuestsModule {}
