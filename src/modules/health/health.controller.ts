import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$runCommandRaw({ ping: 1 });
      return { status: 'ok', database: 'connected', timestamp: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
  }
}
