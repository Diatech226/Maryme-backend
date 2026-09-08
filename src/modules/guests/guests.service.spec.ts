import { UserRole } from '@prisma/client';
import { GuestsService } from './guests.service';

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

describe('GuestsService atomic table updates', () => {
  const user = { sub: 'user-1', role: UserRole.COUPLE, coupleId: 'couple-1' };

  function harness() {
    const guest = {
      id: 'guest-1',
      coupleId: 'couple-1',
      firstName: 'Fatou',
      side: 'BRIDE',
      coupons: 3,
      tableId: null as string | null,
      tableNumber: null as string | null,
    };
    const tables = [
      { id: 'bride-table', coupleId: 'couple-1', number: 18, side: 'BRIDE', capacity: 10 },
      { id: 'groom-table', coupleId: 'couple-1', number: 19, side: 'GROOM', capacity: 10 },
    ];
    const tx = {
      weddingTable: {
        findFirst: jest.fn(({ where }) => {
          const table = tables.find(
            (candidate) =>
              candidate.coupleId === where.coupleId &&
              (where.id ? candidate.id === where.id : candidate.number === where.number),
          );
          return table ? { ...table, guests: [] } : null;
        }),
        findUnique: jest.fn(({ where }) => tables.find((table) => table.id === where.id)),
      },
      guest: {
        update: jest.fn(({ data }) => Object.assign(guest, data)),
      },
    };
    const prisma = {
      couple: { findFirst: jest.fn().mockResolvedValue({ id: 'couple-1', guestQuota: 100 }) },
      guest: {
        findFirst: jest.fn().mockImplementation(() => ({ ...guest })),
        aggregate: jest.fn().mockResolvedValue({ _sum: { coupons: 3 } }),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const service = new GuestsService(
      prisma as never,
      { record: jest.fn() } as never,
      { syncCount: jest.fn() } as never,
    );
    return { service, guest, tx };
  }

  it('assigns, changes side with a compatible table, and unassigns in coherent updates', async () => {
    const { service, guest, tx } = harness();
    await service.update('guest-1', { tableId: 'bride-table' }, user);
    expect(guest).toMatchObject({ tableId: 'bride-table', tableNumber: '18' });

    await service.update('guest-1', { side: 'GROOM' as never, tableId: 'groom-table' }, user);
    expect(guest).toMatchObject({ side: 'GROOM', tableId: 'groom-table', tableNumber: '19' });

    await service.update('guest-1', { tableId: null }, user);
    expect(guest).toMatchObject({ tableId: null, tableNumber: null });
    expect(tx.guest.update).toHaveBeenCalledTimes(3);
  });

  it('automatically unassigns when side changes without a replacement table', async () => {
    const { service, guest } = harness();
    Object.assign(guest, { tableId: 'bride-table', tableNumber: '18' });
    await service.update('guest-1', { side: 'GROOM' as never }, user);
    expect(guest).toMatchObject({ side: 'GROOM', tableId: null, tableNumber: null });
  });

  it('does not persist any guest fields when the requested table is full', async () => {
    const { service, guest, tx } = harness();
    (tx.weddingTable.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'bride-table',
      coupleId: 'couple-1',
      number: 18,
      side: 'BRIDE',
      capacity: 10,
      guests: [{ coupons: 8 }],
    });
    await expect(
      service.update('guest-1', { firstName: 'Changed', tableId: 'bride-table' }, user),
    ).rejects.toThrow('Table capacity exceeded');
    expect(tx.guest.update).not.toHaveBeenCalled();
    expect(guest.firstName).toBe('Fatou');
  });
});
