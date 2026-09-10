import { UserRole } from '@prisma/client';
import { GuestsService } from './guests.service';

describe('GuestsService coupon allocation', () => {
  const user = { sub: 'user-1', role: UserRole.COUPLE, coupleId: 'couple-1' };
  const baseGuest = {
    firstName: 'Awa',
    lastName: 'Diallo',
    side: 'BRIDE',
    coupons: 3,
    category: 'FRIENDS',
  };

  function harness() {
    let sequence = 0;
    const created: Array<Record<string, unknown>> = [];
    const tx = {
      weddingTable: { findFirst: jest.fn(), findUnique: jest.fn() },
      checkIn: { count: jest.fn().mockResolvedValue(0) },
      invitation: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      coupon: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      tableSeatAssignment: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      guest: {
        create: jest.fn(({ data }) => {
          const guest = { id: `guest-${++sequence}`, ...data };
          created.push(guest);
          return guest;
        }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: jest.fn(({ where }) => ({
          ...created.find((guest) => guest.id === where.id),
          couponNumbers: [],
        })),
      },
    };
    const prisma = {
      couple: { findFirst: jest.fn().mockResolvedValue({ id: 'couple-1', guestQuota: 100 }) },
      guest: { aggregate: jest.fn().mockResolvedValue({ _sum: { coupons: 0 } }) },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const couponPool = {
      ensurePool: jest.fn(),
      assignNumbers: jest.fn(),
      assignLowest: jest.fn(),
    };
    return {
      service: new GuestsService(
        prisma as never,
        { record: jest.fn() } as never,
        couponPool as never,
      ),
      couponPool,
      tx,
    };
  }

  it('automatically assigns the lowest coupons when couponNumbers is absent', async () => {
    const { service, couponPool, tx } = harness();
    await service.create('couple-1', baseGuest as never, user);
    expect(couponPool.assignLowest).toHaveBeenCalledWith('guest-1', 3, tx);
    expect(couponPool.assignNumbers).not.toHaveBeenCalled();
  });

  it('propagates pool exhaustion so guest creation is rolled back by its transaction', async () => {
    const { service, couponPool, tx } = harness();
    couponPool.assignLowest.mockRejectedValue({ response: { code: 'COUPON_POOL_EXHAUSTED' } });
    await expect(service.create('couple-1', baseGuest as never, user)).rejects.toMatchObject({
      response: { code: 'COUPON_POOL_EXHAUSTED' },
    });
    expect(tx.guest.create).toHaveBeenCalledTimes(1);
    expect(couponPool.assignLowest).toHaveBeenCalledWith('guest-1', 3, tx);
  });

  it.each([
    { numbers: [12, 13, 14], label: 'an exact manual allocation' },
    { numbers: [], label: 'an explicitly empty manual allocation' },
  ])('delegates $label to CouponPoolService.assignNumbers', async ({ numbers }) => {
    const { service, couponPool, tx } = harness();
    await service.create('couple-1', { ...baseGuest, couponNumbers: numbers } as never, user);
    expect(couponPool.assignNumbers).toHaveBeenCalledWith('guest-1', numbers, tx);
    expect(couponPool.assignLowest).not.toHaveBeenCalled();
  });

  it('honours explicit coupon numbers for every bulk guest', async () => {
    const { service, couponPool, tx } = harness();
    await service.bulk(
      'couple-1',
      { mode: 'append', guests: [{ ...baseGuest, couponNumbers: [12, 13, 14] }] } as never,
      user,
    );
    expect(couponPool.assignNumbers).toHaveBeenCalledWith('guest-1', [12, 13, 14], tx);
    expect(couponPool.assignLowest).not.toHaveBeenCalled();
  });

  it('propagates an allocation conflict so the enclosing bulk transaction can roll back', async () => {
    const { service, couponPool } = harness();
    couponPool.assignNumbers.mockRejectedValue({ response: { code: 'COUPON_ALREADY_ASSIGNED' } });
    await expect(
      service.bulk(
        'couple-1',
        { mode: 'replace', guests: [{ ...baseGuest, couponNumbers: [12, 13, 14] }] } as never,
        user,
      ),
    ).rejects.toMatchObject({ response: { code: 'COUPON_ALREADY_ASSIGNED' } });
  });
});

describe('GuestsService invitation delivery', () => {
  const user = { sub: 'user-1', role: UserRole.COUPLE, coupleId: 'couple-1' };
  const couple = { id: 'couple-1', guestQuota: 100 };
  const active = (extra = {}) => ({
    id: 'guest-1',
    coupleId: 'couple-1',
    invitationSentDate: null,
    ...extra,
  });

  const setup = () => {
    const prisma = {
      couple: { findFirst: jest.fn().mockResolvedValue(couple) },
      guest: {
        findFirst: jest.fn().mockResolvedValue(active()),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockImplementation(({ data }) => ({ ...active(), ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((operations) => Promise.all(operations)),
    };
    const audit = { record: jest.fn() };
    return {
      prisma,
      audit,
      service: new GuestsService(prisma as never, audit as never, {} as never),
    };
  };

  it('sets invitationSentDate explicitly and preserves it on retries', async () => {
    const { service, prisma, audit } = setup();
    const first = await service.markInvitationSent('guest-1', user);
    expect(first).toEqual({ guestId: 'guest-1', invitationSentDate: expect.any(Date) });
    expect(prisma.guest.update).toHaveBeenCalledWith({
      where: { id: 'guest-1' },
      data: { invitationSentDate: first.invitationSentDate },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'INVITATION_SENT' }),
    );

    prisma.guest.findFirst.mockResolvedValue(
      active({ invitationSentDate: first.invitationSentDate }),
    );
    await service.markInvitationSent('guest-1', user);
    expect(prisma.guest.update).toHaveBeenCalledTimes(1);
  });

  it('reuses invitationSentDate and can clear delivery without creating an invitation', async () => {
    const { service, prisma } = setup();
    const marked = await service.updateInvitationDelivery('guest-1', true, user);
    expect(marked.invitationSentDate).toBeInstanceOf(Date);
    await expect(service.updateInvitationDelivery('guest-1', false, user)).resolves.toEqual({
      guestId: 'guest-1',
      invitationSentDate: null,
    });
    expect(prisma.guest.update).toHaveBeenLastCalledWith({
      where: { id: 'guest-1' },
      data: { invitationSentDate: null },
    });
  });

  it('exposes tableNumber, phone, and invitationSentDate in the guest contract', async () => {
    const { service, prisma } = setup();
    const now = new Date();
    prisma.guest.findFirst.mockResolvedValue(
      active({ tableNumber: '8', phone: '+22670000000', invitationSentDate: now }),
    );
    const guest = await service.get('guest-1', user);
    expect(guest).toMatchObject({
      tableNumber: '8',
      phone: '+22670000000',
      invitationSentDate: now,
    });
  });

  it('bulk-updates only guests owned by the requested couple', async () => {
    const { service, prisma, audit } = setup();
    prisma.guest.findMany.mockResolvedValue([{ id: 'guest-1' }, { id: 'guest-2' }]);
    const result = await service.markInvitationsSent(
      'couple-1',
      { guestIds: ['guest-1', 'foreign-guest', 'guest-2'] },
      user,
    );
    expect(result).toEqual({ updated: 2, failed: ['foreign-guest'] });
    expect(prisma.guest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ coupleId: 'couple-1' }) }),
    );
    expect(prisma.guest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['guest-1', 'guest-2'] } }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { coupleId: 'couple-1', count: 2 } }),
    );
  });

  it('combines delivery and phone filters with existing guest filters in one query', async () => {
    const { service, prisma } = setup();
    await service.list(
      'couple-1',
      {
        page: 1,
        limit: 100,
        side: 'GROOM',
        family: 'Traore',
        category: 'VIP',
        rsvpStatus: 'CONFIRMED',
        hasPhone: true,
        invitationSent: false,
      } as never,
      user,
    );
    const query = prisma.guest.findMany.mock.calls[0][0];
    expect(query.where).toEqual(
      expect.objectContaining({
        coupleId: 'couple-1',
        side: 'GROOM',
        family: 'Traore',
        category: 'VIP',
        rsvpStatus: 'CONFIRMED',
        AND: expect.arrayContaining([
          { AND: [{ phone: { not: null } }, { phone: { not: '' } }] },
          {
            OR: [{ invitationSentDate: null }, { invitationSentDate: { isSet: false } }],
          },
        ]),
      }),
    );
    expect(query.include).toEqual(
      expect.objectContaining({
        invitations: expect.any(Object),
        invitationArtifacts: expect.any(Object),
      }),
    );
  });
});

describe('GuestsService modern seating integrity', () => {
  const user = { sub: 'user-1', role: UserRole.COUPLE, coupleId: 'couple-1' };

  function harness(seatCount = 0, coupons = 3) {
    const guest = {
      id: 'guest-1',
      coupleId: 'couple-1',
      firstName: 'Fatou',
      side: 'BRIDE',
      coupons,
      tableId: 'legacy-table',
      tableNumber: '18',
      assignedSeats: ['legacy'],
      couponNumbers: [],
      deletedAt: null,
    };
    const tx = {
      weddingTable: { findUnique: jest.fn() },
      tableSeatAssignment: {
        count: jest.fn().mockResolvedValue(seatCount),
        deleteMany: jest.fn().mockResolvedValue({ count: seatCount }),
      },
      coupon: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      invitation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      guest: {
        update: jest.fn(({ data }) => Object.assign(guest, data)),
        findUniqueOrThrow: jest.fn(() => ({ ...guest, couponNumbers: [] })),
      },
    };
    const prisma = {
      couple: { findFirst: jest.fn().mockResolvedValue({ id: 'couple-1', guestQuota: 100 }) },
      guest: {
        findFirst: jest.fn(() => ({ ...guest })),
        aggregate: jest.fn().mockResolvedValue({ _sum: { coupons } }),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const couponPool = { syncCount: jest.fn(), assignNumbers: jest.fn() };
    return {
      service: new GuestsService(
        prisma as never,
        { record: jest.fn() } as never,
        couponPool as never,
      ),
      guest,
      tx,
      couponPool,
    };
  }

  it('allows changing coupons for an unseated guest', async () => {
    const { service, guest } = harness();
    await service.update('guest-1', { coupons: 4 }, user);
    expect(guest.coupons).toBe(4);
  });

  it('allows a phone-only PATCH for a historical guest with more than 10 coupons', async () => {
    const { service, guest, couponPool } = harness(0, 15);
    await service.update('guest-1', { phone: '+22670000000' }, user);
    expect(guest).toMatchObject({ coupons: 15, phone: '+22670000000' });
    expect(couponPool.syncCount).not.toHaveBeenCalled();
  });

  it('accepts an unchanged coupon count for a seated guest', async () => {
    const { service, tx } = harness(3);
    await expect(service.update('guest-1', { coupons: 3 }, user)).resolves.toBeDefined();
    expect(tx.guest.update).toHaveBeenCalled();
  });

  it('rejects changing coupons while modern physical seats exist', async () => {
    const { service, tx } = harness(3);
    await expect(service.update('guest-1', { coupons: 4 }, user)).rejects.toMatchObject({
      response: {
        code: 'SEATING_REASSIGN_REQUIRED',
        message: 'Remove or update the guest seating before changing the requested seat count.',
      },
    });
    expect(tx.guest.update).not.toHaveBeenCalled();
  });

  it('does not let a generic update silently modify seating compatibility fields', async () => {
    const { service, guest } = harness();
    await service.update(
      'guest-1',
      {
        firstName: 'Changed',
        tableId: 'attacker-table',
        tableNumber: 9,
        assignedSeats: ['9'],
      } as never,
      user,
    );
    expect(guest).toMatchObject({
      firstName: 'Changed',
      tableId: 'legacy-table',
      tableNumber: '18',
      assignedSeats: ['legacy'],
    });
  });

  it('releases physical seats in the same transaction as the guest soft-delete', async () => {
    const { service, tx } = harness(3);
    await service.remove('guest-1', user);
    expect(tx.tableSeatAssignment.deleteMany).toHaveBeenCalledWith({
      where: { guestId: 'guest-1' },
    });
    expect(tx.guest.update).toHaveBeenCalledWith({
      where: { id: 'guest-1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(tx.coupon.updateMany).toHaveBeenCalledWith({
      where: { guestId: 'guest-1', status: 'ASSIGNED' },
      data: {
        guestId: null,
        status: 'AVAILABLE',
        assignedAt: null,
        releasedAt: expect.any(Date),
      },
    });
    expect(tx.invitation.updateMany).toHaveBeenCalledWith({
      where: { guestId: 'guest-1', status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: expect.any(Date) },
    });
  });
});
