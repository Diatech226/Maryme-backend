import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}
  record(data: Prisma.AuditLogUncheckedCreateInput): void { void this.prisma.auditLog.create({ data }).catch((error: unknown) => this.logger.warn(`Audit write failed: ${error instanceof Error ? error.message : 'unknown error'}`)); }
}
