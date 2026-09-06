import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CoupleStatus, Prisma, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthUser } from '../../common/types/auth-user';
import { assertCoupleAccess } from '../../common/utils/ownership';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CoupleQueryDto, CreateCoupleDto, UpdateCoupleDto } from './dto/couple.dto';

@Injectable()
export class CouplesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  async list(q: CoupleQueryDto) {
    const where: Prisma.CoupleWhereInput = {
      AND: [{ OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] }],
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { partner1: { contains: q.search, mode: 'insensitive' } },
              { partner2: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.couple.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.couple.count({ where }),
    ]);
    return {
      data,
      meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
    };
  }
  async create(dto: CreateCoupleDto, actor: AuthUser) {
    const { accountEmail, accountPassword, ...couple } = dto;
    if (Boolean(accountEmail) !== Boolean(accountPassword))
      throw new BadRequestException('accountEmail and accountPassword must be provided together');
    const passwordHash = accountPassword ? await argon2.hash(accountPassword) : undefined;
    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.couple.create({ data: couple });
      if (accountEmail && passwordHash)
        await tx.user.create({
          data: {
            email: accountEmail.toLowerCase(),
            passwordHash,
            role: UserRole.COUPLE,
            coupleId: created.id,
          },
        });
      return created;
    });
    void this.audit.record({
      userId: actor.sub,
      action: 'COUPLE_CREATED',
      entityType: 'Couple',
      entityId: result.id,
    });
    return result;
  }
  async get(id: string, user: AuthUser) {
    assertCoupleAccess(user, id);
    const couple = await this.prisma.couple.findFirst({
      where: { id, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
    });
    if (!couple) throw new NotFoundException('Couple not found');
    return couple;
  }
  async update(id: string, dto: UpdateCoupleDto, user: AuthUser) {
    await this.get(id, user);
    const { guestQuota, ...selfData } = dto;
    const data = user.role === UserRole.SUPER_ADMIN ? dto : selfData;
    const result = await this.prisma.couple.update({ where: { id }, data });
    void this.audit.record({
      userId: user.sub,
      action: 'COUPLE_UPDATED',
      entityType: 'Couple',
      entityId: id,
    });
    return result;
  }
  async status(id: string, status: CoupleStatus, user: AuthUser) {
    await this.get(id, user);
    const result = await this.prisma.couple.update({
      where: { id },
      data: { status, authorizedAt: status === CoupleStatus.AUTHORIZED ? new Date() : null },
    });
    void this.audit.record({
      userId: user.sub,
      action: status === CoupleStatus.AUTHORIZED ? 'COUPLE_AUTHORIZED' : 'COUPLE_SUSPENDED',
      entityType: 'Couple',
      entityId: id,
    });
    return result;
  }
  async remove(id: string, user: AuthUser): Promise<void> {
    await this.get(id, user);
    await this.prisma.$transaction([
      this.prisma.user.updateMany({ where: { coupleId: id }, data: { isActive: false } }),
      this.prisma.couple.update({
        where: { id },
        data: { deletedAt: new Date(), status: CoupleStatus.SUSPENDED },
      }),
    ]);
    void this.audit.record({
      userId: user.sub,
      action: 'COUPLE_DELETED',
      entityType: 'Couple',
      entityId: id,
    });
  }
}
