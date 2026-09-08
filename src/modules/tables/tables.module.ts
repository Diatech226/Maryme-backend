import { Module } from '@nestjs/common';
import { GuestTableAssignmentController, TablesController } from './tables.controller';
import { TablesService } from './tables.service';
@Module({
  controllers: [TablesController, GuestTableAssignmentController],
  providers: [TablesService],
  exports: [TablesService],
})
export class TablesModule {}
