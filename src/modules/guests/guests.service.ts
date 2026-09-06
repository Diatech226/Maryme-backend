import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertCoupleAccess } from '../../common/utils/ownership';
import { AuthUser } from '../../common/types/auth-user';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  BulkCreateGuestsDto,
  BulkGuestsMode,
  CreateGuestDto,
  GuestQueryDto,
  UpdateGuestDto,
} from './dto/guest.dto';
import { assertQuota } from './quota';
@Injectable()
export class GuestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  private async couple(id: string, user: AuthUser) {
    assertCoupleAccess(user, id);
    const c = await this.prisma.couple.findFirst({
      where: { id, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
    });
    if (!c) throw new NotFoundException('Couple not found');
    return c;
  }
  private async used(id: string) {
    return (
      (
        await this.prisma.guest.aggregate({
          where: { coupleId: id, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
          _sum: { coupons: true },
        })
      )._sum.coupons ?? 0
    );
  }
  async list(id: string, q: GuestQueryDto, user: AuthUser) {
    await this.couple(id, user);
    const where: Prisma.GuestWhereInput = {
      coupleId: id,
      AND: [{ OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] }],
      ...(q.search
        ? {
            OR: [
              { firstName: { contains: q.search, mode: 'insensitive' } },
              { lastName: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(q.side ? { side: q.side } : {}),
      ...(q.family ? { family: q.family } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.rsvpStatus ? { rsvpStatus: q.rsvpStatus } : {}),
      ...(q.tableNumber ? { tableNumber: q.tableNumber } : {}),
      ...(q.checkedIn === undefined ? {} : { checkIn: q.checkedIn ? { isNot: null } : null }),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.guest.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.guest.count({ where }),
    ]);
    return {
      data,
      meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
    };
  }
  async create(id: string, dto: CreateGuestDto, user: AuthUser) {
    const c = await this.couple(id, user);
    assertQuota(await this.used(id), dto.coupons, c.guestQuota);
    const g = await this.prisma.guest.create({ data: { ...dto, coupleId: id } });
    this.audit.record({
      userId: user.sub,
      action: 'GUEST_CREATED',
      entityType: 'Guest',
      entityId: g.id,
    });
    return g;
  }
  async bulk(id: string, dto: BulkCreateGuestsDto, user: AuthUser) {
    const c = await this.couple(id, user);
    const incoming = dto.guests.reduce((n, g) => n + g.coupons, 0);
    assertQuota(
      dto.mode === BulkGuestsMode.REPLACE ? 0 : await this.used(id),
      incoming,
      c.guestQuota,
    );
    await this.prisma.$transaction(async (tx) => {
      if (dto.mode === BulkGuestsMode.REPLACE) {
        if (await tx.checkIn.count({ where: { coupleId: id } }))
          throw new ConflictException(
            'Impossible de remplacer les invités après le début des contrôles d’entrée.',
          );
        // Invitations contain token hashes tied to the old guest set: deleting them
        // atomically revokes every previously issued QR code before guests are replaced.
        await tx.invitation.deleteMany({ where: { coupleId: id } });
        await tx.guest.deleteMany({ where: { coupleId: id } });
      }
      for (const guest of dto.guests) await tx.guest.create({ data: { ...guest, coupleId: id } });
    });
    void this.audit.record({
      userId: user.sub,
      action: dto.mode === BulkGuestsMode.REPLACE ? 'GUESTS_REPLACED' : 'GUESTS_IMPORTED',
      entityType: 'Couple',
      entityId: id,
      metadata: { count: dto.guests.length },
    });
    return { created: dto.guests.length, failed: 0 };
  }
  async get(id: string, user: AuthUser) {
    const g = await this.prisma.guest.findFirst({
      where: { id, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
    });
    if (!g) throw new NotFoundException('Guest not found');
    assertCoupleAccess(user, g.coupleId);
    return g;
  }
  async update(id: string, dto: UpdateGuestDto, user: AuthUser) {
    const g = await this.get(id, user);
    if (dto.coupons) {
      const c = await this.couple(g.coupleId, user);
      assertQuota((await this.used(g.coupleId)) - g.coupons, dto.coupons, c.guestQuota);
    }
    const result = await this.prisma.guest.update({ where: { id }, data: dto });
    this.audit.record({
      userId: user.sub,
      action: 'GUEST_UPDATED',
      entityType: 'Guest',
      entityId: id,
    });
    return result;
  }
  async remove(id: string, user: AuthUser) {
    await this.get(id, user);
    await this.prisma.guest.update({ where: { id }, data: { deletedAt: new Date() } });
    this.audit.record({
      userId: user.sub,
      action: 'GUEST_DELETED',
      entityType: 'Guest',
      entityId: id,
    });
  }
}
