import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch {
      // Keep credentials and the Atlas hostname out of startup logs.
      this.logger.error('DATABASE_CONNECTION_FAILED: Prisma could not connect to MongoDB');
      throw new Error('DATABASE_CONNECTION_FAILED: required MongoDB database is unavailable');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
