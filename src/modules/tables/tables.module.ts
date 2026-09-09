import { Module } from '@nestjs/common';
import { GuestTableAssignmentController, TablesController } from './tables.controller';
import { GuestsModule } from '../guests/guests.module';
import { TablesService } from './tables.service';
@Module({
  imports: [GuestsModule],
  controllers: [TablesController, GuestTableAssignmentController],
  providers: [TablesService],
  exports: [TablesService],
})
export class TablesModule {}
