import { ConflictException } from '@nestjs/common';
import { GuestSide, UserRole } from '@prisma/client';
import { TablesService } from './tables.service';

const user = { sub: 'user', role: UserRole.COUPLE, coupleId: 'couple' };
const plan = {
  totalTables: 40,
  rules: [
    { from: 1, to: 30, oddSide: GuestSide.GROOM, evenSide: GuestSide.BRIDE },
    { from: 31, to: 40, side: GuestSide.GROOM },
  ],
};

describe('TablesService', () => {
  function harness() {
    const rows: Array<{
      id: string;
      coupleId: string;
      number: number;
      side: GuestSide;
      capacity?: number;
    }> = [];
    const tx = {
      guest: { count: jest.fn().mockResolvedValue(0) },
      weddingTable: {
        deleteMany: jest.fn(),
        upsert: jest.fn(({ create }) => {
          const old = rows.find((r) => r.number === create.number);
          if (old) Object.assign(old, create);
          else rows.push({ id: `t${create.number}`, ...create });
        }),
        findMany: jest
          .fn()
          .mockImplementation(() => Promise.resolve([...rows].sort((a, b) => a.number - b.number))),
      },
    };
    const prisma = {
      couple: { findFirst: jest.fn().mockResolvedValue({ id: 'couple' }) },
      $transaction: jest.fn((callback) => callback(tx)),
      weddingTable: {},
    };
    return { service: new TablesService(prisma as never), rows, tx };
  }

  it('generates the configurable 40-table bride/groom plan exactly', async () => {
    const { service } = harness();
    const tables = await service.generate('couple', plan, user);
    expect(tables.filter((t) => t.side === GuestSide.BRIDE).map((t) => t.number)).toEqual([
      2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30,
    ]);
    expect(tables.filter((t) => t.side === GuestSide.GROOM).map((t) => t.number)).toEqual([
      1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
    ]);
  });

  it('rejects a side mismatch and counts coupons for capacity', async () => {
    const prisma = {
      couple: { findFirst: jest.fn().mockResolvedValue({ id: 'couple' }) },
      guest: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'g', coupleId: 'couple', side: GuestSide.BRIDE, coupons: 3 }),
      },
      weddingTable: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 't', side: GuestSide.GROOM, capacity: 10, guests: [] }),
      },
    };
    await expect(
      new TablesService(prisma as never).assign('couple', 'g', { tableId: 't' }, user),
    ).rejects.toBeInstanceOf(ConflictException);
    prisma.guest.findFirst.mockResolvedValue({
      id: 'g',
      coupleId: 'couple',
      side: GuestSide.GROOM,
      coupons: 3,
    });
    prisma.weddingTable.findFirst.mockResolvedValue({
      id: 't',
      side: GuestSide.GROOM,
      capacity: 10,
      guests: [{ coupons: 8 }],
    });
    await expect(
      new TablesService(prisma as never).assign('couple', 'g', { tableId: 't' }, user),
    ).rejects.toThrow('Table capacity exceeded');
  });
});
