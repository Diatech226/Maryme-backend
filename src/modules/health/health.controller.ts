import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async check() {
    try {
      await this.prisma.$runCommandRaw({ ping: 1 });
    } catch {
      throw new ServiceUnavailableException({
        status: 'degraded',
        database: 'disconnected',
      });
    }

    const storage = await this.storage.status();
    const health = {
      status: storage.connected ? 'ok' : 'degraded',
      database: 'connected',
      storage,
    };
    if (!storage.connected) throw new ServiceUnavailableException(health);
    return health;
  }
}
