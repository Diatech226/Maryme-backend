import { Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { CouplesController } from './couples.controller';
import { CouplesService } from './couples.service';

@Module({
  controllers: [CouplesController, AccessController],
  providers: [CouplesService],
  exports: [CouplesService],
})
export class CouplesModule {}
