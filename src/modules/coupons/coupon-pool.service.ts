import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CouponStatus, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/types/auth-user';
import { assertCoupleAccess } from '../../common/utils/ownership';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CouponQueryDto } from './dto/coupon.dto';
type Db = Prisma.TransactionClient | PrismaService;
@Injectable()
export class CouponPoolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  async ensurePool(coupleId: string, quota: number, db: Db = this.prisma) {
    const existing = await db.coupon.findMany({ where: { coupleId }, select: { number: true } });
    const numbers = new Set(existing.map((c) => c.number));
    const missing = Array.from({ length: quota }, (_, i) => i + 1).filter((n) => !numbers.has(n));
    if (missing.length)
      await db.coupon.createMany({ data: missing.map((number) => ({ coupleId, number })) });
    return missing.length;
  }
  async resize(coupleId: string, oldQuota: number, quota: number, db: Db = this.prisma) {
    await this.ensurePool(coupleId, Math.max(oldQuota, quota), db);
    if (quota < oldQuota) {
      const inUse = await db.coupon.count({
        where: {
          coupleId,
          number: { gt: quota },
          status: { in: [CouponStatus.ASSIGNED, CouponStatus.USED] },
        },
      });
      if (inUse)
        throw new ConflictException({
          code: 'COUPON_QUOTA_IN_USE',
          message: 'Des coupons hors du nouveau quota sont utilisés ou attribués.',
        });
      await db.coupon.deleteMany({
        where: { coupleId, number: { gt: quota }, status: CouponStatus.AVAILABLE },
      });
    }
  }
  async assignLowest(guestId: string, count: number, db: Db = this.prisma) {
    if (count <= 0) return [];
    const guest = await db.guest.findUnique({ where: { id: guestId } });
    if (!guest) throw new NotFoundException('Guest not found');
    const available = await db.coupon.findMany({
      where: { coupleId: guest.coupleId, status: CouponStatus.AVAILABLE },
      orderBy: { number: 'asc' },
      take: count,
    });
    if (available.length !== count)
      throw new ConflictException({
        code: 'COUPON_POOL_EXHAUSTED',
        message: 'Pas assez de coupons disponibles.',
      });
    const now = new Date();
    await db.coupon
      .updateMany({
        where: { id: { in: available.map((c) => c.id) }, status: CouponStatus.AVAILABLE },
        data: { guestId, status: CouponStatus.ASSIGNED, assignedAt: now, releasedAt: null },
      })
      .then((result) => {
        if (result.count !== count)
          throw new ConflictException({
            code: 'COUPON_ALLOCATION_CONFLICT',
            message: "L'attribution concurrente des coupons a échoué; veuillez réessayer.",
          });
      });
    return available.map((c) => c.number);
  }
  async syncCount(guestId: string, desired: number, db: Db = this.prisma) {
    const current = await db.coupon.findMany({ where: { guestId }, orderBy: { number: 'asc' } });
    if (current.some((c) => c.status === CouponStatus.USED)) {
      if (current.length !== desired)
        throw new ConflictException({
          code: 'COUPON_ALREADY_USED',
          message: "L'allocation d'un invité contrôlé est immuable.",
        });
      // The complete allocation is frozen as soon as one coupon is used. In
      // particular, USED coupons must count toward `desired`: looking only at
      // ASSIGNED rows here would incorrectly allocate replacements for them.
      return { assigned: [] as number[], released: [] as number[] };
    }
    const assigned = current.filter((c) => c.status === CouponStatus.ASSIGNED);
    if (assigned.length < desired)
      return {
        assigned: await this.assignLowest(guestId, desired - assigned.length, db),
        released: [] as number[],
      };
    const release = assigned.slice(desired);
    if (release.length)
      await db.coupon.updateMany({
        where: { id: { in: release.map((c) => c.id) } },
        data: {
          guestId: null,
          status: CouponStatus.AVAILABLE,
          assignedAt: null,
          releasedAt: new Date(),
        },
      });
    return { assigned: [], released: release.map((c) => c.number) };
  }
  async assignNumbers(guestId: string, numbers: number[], db: Db = this.prisma) {
    const guest = await db.guest.findUnique({ where: { id: guestId } });
    if (!guest) throw new NotFoundException('Guest not found');
    if (numbers.length !== guest.coupons || new Set(numbers).size !== numbers.length)
      throw new ConflictException({
        code: 'COUPON_COUNT_MISMATCH',
        message: 'Le nombre de numéros doit correspondre à Guest.coupons, sans doublon.',
      });
    const selected = await db.coupon.findMany({
      where: { coupleId: guest.coupleId, number: { in: numbers } },
    });
    if (selected.length !== numbers.length || selected.some((c) => c.status === CouponStatus.VOID))
      throw new NotFoundException({ code: 'COUPON_NOT_FOUND', message: 'Coupon inexistant.' });
    if (
      selected.some((c) => c.status === CouponStatus.USED) ||
      (await db.coupon.count({ where: { guestId, status: CouponStatus.USED } }))
    )
      throw new ConflictException({ code: 'COUPON_ALREADY_USED', message: 'Coupon déjà utilisé.' });
    if (selected.some((c) => c.guestId && c.guestId !== guestId))
      throw new ConflictException({
        code: 'COUPON_ALREADY_ASSIGNED',
        message: 'Coupon déjà attribué.',
      });
    const now = new Date();
    await db.coupon.updateMany({
      where: { guestId, status: CouponStatus.ASSIGNED, number: { notIn: numbers } },
      data: { guestId: null, status: CouponStatus.AVAILABLE, assignedAt: null, releasedAt: now },
    });
    await db.coupon.updateMany({
      where: { coupleId: guest.coupleId, number: { in: numbers } },
      data: { guestId, status: CouponStatus.ASSIGNED, assignedAt: now, releasedAt: null },
    });
    return numbers;
  }
  async manuallyAssign(guestId: string, numbers: number[], user: AuthUser) {
    const guest = await this.prisma.guest.findUnique({ where: { id: guestId } });
    if (!guest || guest.deletedAt) throw new NotFoundException('Guest not found');
    assertCoupleAccess(user, guest.coupleId);
    await this.prisma.$transaction(async (tx) => {
      await this.assignNumbers(guestId, numbers, tx);
    });
    this.audit.record({
      userId: user.sub,
      action: 'COUPONS_REASSIGNED',
      entityType: 'Guest',
      entityId: guestId,
      metadata: { count: numbers.length },
    });
    return this.prisma.coupon.findMany({ where: { guestId }, orderBy: { number: 'asc' } });
  }
  async summary(coupleId: string, user: AuthUser) {
    assertCoupleAccess(user, coupleId);
    const couple = await this.prisma.couple.findUnique({ where: { id: coupleId } });
    if (!couple) throw new NotFoundException('Couple not found');
    await this.ensurePool(coupleId, couple.guestQuota);
    const grouped = await this.prisma.coupon.groupBy({
      by: ['status'],
      where: { coupleId },
      _count: true,
    });
    const counts = Object.fromEntries(grouped.map((x) => [x.status.toLowerCase(), x._count]));
    return {
      quota: couple.guestQuota,
      total: grouped.reduce((n, x) => n + x._count, 0),
      available: counts.available ?? 0,
      assigned: counts.assigned ?? 0,
      used: counts.used ?? 0,
      void: counts.void ?? 0,
    };
  }
  async list(coupleId: string, q: CouponQueryDto, user: AuthUser) {
    assertCoupleAccess(user, coupleId);
    const where: Prisma.CouponWhereInput = {
      coupleId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.guestId ? { guestId: q.guestId } : {}),
      ...(q.number ? { number: q.number } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.coupon.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { number: 'asc' },
        include: { guest: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.coupon.count({ where }),
    ]);
    return {
      data,
      meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
    };
  }
  async reconcile(coupleId: string, auto: boolean, user: AuthUser) {
    assertCoupleAccess(user, coupleId);
    const couple = await this.prisma.couple.findUnique({ where: { id: coupleId } });
    if (!couple) throw new NotFoundException('Couple not found');
    const result = await this.prisma.$transaction(async (tx) => {
      await this.ensurePool(coupleId, couple.guestQuota, tx);
      const load = () =>
        tx.guest.findMany({
          where: { coupleId, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
          include: { couponNumbers: true, checkIn: { select: { id: true } } },
        });
      const anomalies = (guests: Awaited<ReturnType<typeof load>>) => ({
        shortages: guests
          .filter((guest) => guest.couponNumbers.length < guest.coupons)
          .map((guest) => ({
            guestId: guest.id,
            expected: guest.coupons,
            actual: guest.couponNumbers.length,
          })),
        excess: guests
          .filter((guest) => guest.couponNumbers.length > guest.coupons)
          .map((guest) => ({
            guestId: guest.id,
            expected: guest.coupons,
            actual: guest.couponNumbers.length,
          })),
      });
      const guests = await load();
      const detected = anomalies(guests);
      let autoAssigned = 0;
      if (auto) {
        const byId = new Map(guests.map((guest) => [guest.id, guest]));
        for (const item of [...detected.shortages, ...detected.excess]) {
          const guest = byId.get(item.guestId)!;
          // A check-in (or any USED coupon) freezes the complete numbered allocation.
          if (
            guest.checkIn ||
            guest.couponNumbers.some((coupon) => coupon.status === CouponStatus.USED)
          )
            continue;
          const change = await this.syncCount(item.guestId, item.expected, tx);
          autoAssigned += change.assigned.length;
        }
      }
      const remaining = auto ? anomalies(await load()) : detected;
      const available = await tx.coupon.count({
        where: { coupleId, status: CouponStatus.AVAILABLE },
      });
      return { ...remaining, available, autoAssigned };
    });
    this.audit.record({
      userId: user.sub,
      action: 'COUPONS_RECONCILED',
      entityType: 'Couple',
      entityId: coupleId,
      metadata: {
        shortages: result.shortages.length,
        excess: result.excess.length,
        autoAssignMissing: auto,
        autoAssigned: result.autoAssigned,
      },
    });
    return result;
  }
}
