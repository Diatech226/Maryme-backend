import { InvitationStatus, UserRole } from '@prisma/client';
import { InvitationsService } from './invitations.service';

describe('InvitationsService', () => {
  const user = { sub: 'user-1', role: UserRole.COUPLE, coupleId: 'couple-1' };
  const guest = {
    id: 'guest-1',
    coupleId: 'couple-1',
    coupons: 3,
    tableId: 'table-8',
    tableNumber: '8',
    assignedSeats: ['1', '2', '3'],
  };

  it('returns unique raw QR tokens while persisting only distinct hashes', async () => {
    const created: Array<Record<string, unknown>> = [];
    const tx = {
      invitation: {
        updateMany: jest.fn(),
        create: jest.fn(({ data }) => {
          created.push(data);
          return { id: `invitation-${created.length}`, ...data };
        }),
      },
    };
    const prisma = {
      guest: {
        findFirst: jest.fn(({ where }) => Promise.resolve({ ...guest, id: where.id })),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const audit = { record: jest.fn() };
    const service = new InvitationsService(prisma as never, audit as never);

    const first = await service.generate('guest-1', { revokePrevious: false }, user);
    const second = await service.generate('guest-2', { revokePrevious: false }, user);

    expect(first.token).not.toBe(second.token);
    expect(first.qrPayload.token).toBe(first.token);
    expect(created[0].tokenHash).toBe(service.hash(first.token));
    expect(created[1].tokenHash).toBe(service.hash(second.token));
    expect(created[0].tokenHash).not.toBe(created[1].tokenHash);
    expect(first).not.toHaveProperty('tokenHash');
    expect(second).not.toHaveProperty('tokenHash');
    expect(guest).toMatchObject({
      coupons: 3,
      tableId: 'table-8',
      tableNumber: '8',
      assignedSeats: ['1', '2', '3'],
    });
    expect(tx).not.toHaveProperty('guest');
    expect(tx).not.toHaveProperty('tableSeatAssignment');
    expect(tx).not.toHaveProperty('coupon');
  });

  it('revokes prior active invitations in the same transaction when requested', async () => {
    const tx = {
      invitation: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        create: jest.fn(({ data }) => ({ id: 'new-invitation', ...data })),
      },
    };
    const prisma = {
      guest: { findFirst: jest.fn().mockResolvedValue(guest) },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const service = new InvitationsService(prisma as never, { record: jest.fn() } as never);

    await service.generate('guest-1', { revokePrevious: true }, user);

    expect(tx.invitation.updateMany).toHaveBeenCalledWith({
      where: { guestId: 'guest-1', status: InvitationStatus.ACTIVE },
      data: { status: InvitationStatus.REVOKED, revokedAt: expect.any(Date) },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
