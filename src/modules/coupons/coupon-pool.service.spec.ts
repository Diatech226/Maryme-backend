import { ConflictException, NotFoundException } from '@nestjs/common';
import { CouponStatus, UserRole } from '@prisma/client';
import { CouponPoolService } from './coupon-pool.service';

describe('CouponPoolService numbered allocation', () => {
  const user = { sub: 'user-1', role: UserRole.COUPLE, coupleId: 'couple-1' };
  const guest = { id: 'guest-1', coupleId: 'couple-1', coupons: 3 };

  const coupon = (
    number: number,
    status: CouponStatus = CouponStatus.ASSIGNED,
    guestId: string | null = guest.id,
  ) => ({ id: `coupon-${number}`, coupleId: guest.coupleId, number, status, guestId });

  function service(prisma: Record<string, unknown>) {
    return new CouponPoolService(prisma as never, { record: jest.fn() } as never);
  }

  it('assigns exactly the requested lowest available coupons', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 3 });
    const db = {
      guest: { findUnique: jest.fn().mockResolvedValue(guest) },
      coupon: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            coupon(12, CouponStatus.AVAILABLE, null),
            coupon(13, CouponStatus.AVAILABLE, null),
            coupon(14, CouponStatus.AVAILABLE, null),
          ]),
        updateMany,
      },
    };
    await expect(service(db).assignLowest(guest.id, 3, db as never)).resolves.toEqual([12, 13, 14]);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['coupon-12', 'coupon-13', 'coupon-14'] }, status: 'AVAILABLE' },
        data: expect.objectContaining({ guestId: guest.id, status: 'ASSIGNED' }),
      }),
    );
  });

  it('rejects shortages and concurrent partial assignments instead of returning invented numbers', async () => {
    const db = {
      guest: { findUnique: jest.fn().mockResolvedValue(guest) },
      coupon: {
        findMany: jest.fn().mockResolvedValue([coupon(12, CouponStatus.AVAILABLE, null)]),
        updateMany: jest.fn(),
      },
    };
    await expect(service(db).assignLowest(guest.id, 3, db as never)).rejects.toMatchObject({
      response: { code: 'COUPON_POOL_EXHAUSTED' },
    });
    db.coupon.findMany.mockResolvedValue([
      coupon(12, CouponStatus.AVAILABLE, null),
      coupon(13, CouponStatus.AVAILABLE, null),
      coupon(14, CouponStatus.AVAILABLE, null),
    ]);
    db.coupon.updateMany.mockResolvedValue({ count: 2 });
    await expect(service(db).assignLowest(guest.id, 3, db as never)).rejects.toMatchObject({
      response: { code: 'COUPON_ALLOCATION_CONFLICT' },
    });
  });

  it('adds one coupon on 2→3 and releases only the highest ASSIGNED coupon on 3→2', async () => {
    const pool = service({});
    const growDb = { coupon: { findMany: jest.fn().mockResolvedValue([coupon(12), coupon(13)]) } };
    jest.spyOn(pool, 'assignLowest').mockResolvedValue([14]);
    await expect(pool.syncCount(guest.id, 3, growDb as never)).resolves.toEqual({
      assigned: [14],
      released: [],
    });
    expect(pool.assignLowest).toHaveBeenCalledWith(guest.id, 1, growDb);

    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const shrinkDb = {
      coupon: {
        findMany: jest.fn().mockResolvedValue([coupon(12), coupon(13), coupon(14)]),
        updateMany,
      },
    };
    await expect(pool.syncCount(guest.id, 2, shrinkDb as never)).resolves.toEqual({
      assigned: [],
      released: [14],
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['coupon-14'] } } }),
    );
  });

  it('never changes an allocation containing a USED coupon', async () => {
    const db = {
      coupon: {
        findMany: jest.fn().mockResolvedValue([coupon(12, CouponStatus.USED), coupon(13)]),
      },
    };
    await expect(service({}).syncCount(guest.id, 3, db as never)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.coupon.findMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    { numbers: [12, 13], code: 'COUPON_COUNT_MISMATCH' },
    { numbers: [12, 12, 13], code: 'COUPON_COUNT_MISMATCH' },
  ])('rejects invalid manual allocation $numbers', async ({ numbers, code }) => {
    const db = { guest: { findUnique: jest.fn().mockResolvedValue(guest) } };
    await expect(service({}).assignNumbers(guest.id, numbers, db as never)).rejects.toMatchObject({
      response: { code },
    });
  });

  it('rejects missing and already-owned manual numbers', async () => {
    const findUnique = jest.fn().mockResolvedValue(guest);
    const db = {
      guest: { findUnique },
      coupon: {
        findMany: jest.fn().mockResolvedValue([coupon(12), coupon(13)]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    await expect(
      service({}).assignNumbers(guest.id, [12, 13, 99], db as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    db.coupon.findMany.mockResolvedValue([
      coupon(12),
      coupon(13),
      coupon(14, CouponStatus.ASSIGNED, 'guest-2'),
    ]);
    await expect(
      service({}).assignNumbers(guest.id, [12, 13, 14], db as never),
    ).rejects.toMatchObject({
      response: { code: 'COUPON_ALREADY_ASSIGNED' },
    });
  });

  it('repairs shortage and excess transactionally without reading seating or invitations', async () => {
    const state = [coupon(12), coupon(13)];
    const available = [
      coupon(14, CouponStatus.AVAILABLE, null),
      coupon(15, CouponStatus.AVAILABLE, null),
    ];
    const tx = {
      guest: {
        findMany: jest.fn(async () => [{ ...guest, couponNumbers: [...state], checkIn: null }]),
        findUnique: jest.fn().mockResolvedValue(guest),
      },
      coupon: {
        findMany: jest.fn(async ({ where }: { where: { status?: CouponStatus } }) => {
          if (where.status === CouponStatus.AVAILABLE) return available.slice(0, 1);
          return [...state];
        }),
        updateMany: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { id?: { in: string[] } };
            data: { status: CouponStatus };
          }) => {
            if (data.status === CouponStatus.ASSIGNED) {
              const assigned = available.shift()!;
              state.push({ ...assigned, status: CouponStatus.ASSIGNED, guestId: guest.id });
            }
            if (data.status === CouponStatus.AVAILABLE && where.id) {
              const released = new Set(where.id.in);
              state.splice(0, state.length, ...state.filter((item) => !released.has(item.id)));
            }
            return { count: 1 };
          },
        ),
        count: jest.fn().mockResolvedValue(1),
        createMany: jest.fn(),
      },
    };
    const prisma = {
      couple: { findUnique: jest.fn().mockResolvedValue({ id: 'couple-1', guestQuota: 4 }) },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const pool = service(prisma);
    jest.spyOn(pool, 'ensurePool').mockResolvedValue(0);
    await expect(pool.reconcile('couple-1', true, user)).resolves.toEqual({
      shortages: [],
      excess: [],
      available: 1,
      autoAssigned: 1,
    });
    expect(tx).not.toHaveProperty('tableSeatAssignment');
    expect(tx).not.toHaveProperty('invitation');

    state.push(coupon(16));
    await expect(pool.reconcile('couple-1', true, user)).resolves.toMatchObject({
      excess: [],
      autoAssigned: 0,
    });
    expect(tx.coupon.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ guestId: null, status: CouponStatus.AVAILABLE }),
      }),
    );
  });
});
