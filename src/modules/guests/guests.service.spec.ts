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
