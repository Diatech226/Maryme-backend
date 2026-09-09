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
      capacity?: number | null;
    }> = [];
    const tx = {
      guest: { count: jest.fn().mockResolvedValue(0) },
      weddingTable: {
        deleteMany: jest.fn(({ where }) => {
          const retained: number[] = where.number?.notIn ?? [];
          for (let index = rows.length - 1; index >= 0; index--)
            if (!retained.includes(rows[index].number)) rows.splice(index, 1);
          return { count: 0 };
        }),
        upsert: jest.fn(({ create }) => {
          const old = rows.find((r) => r.number === create.number);
          if (old) Object.assign(old, create);
          else rows.push({ id: `t${create.number}`, ...create });
        }),
        findMany: jest
          .fn()
          .mockImplementation(() =>
            Promise.resolve(
              [...rows]
                .sort((a, b) => a.number - b.number)
                .map((row) => ({ ...row, capacity: row.capacity ?? null, guests: [] })),
            ),
          ),
      },
    };
    const prisma = {
      couple: { findFirst: jest.fn().mockResolvedValue({ id: 'couple' }) },
      $transaction: jest.fn((callback) => callback(tx)),
      weddingTable: {
        findMany: jest.fn(() =>
          [...rows]
            .sort((a, b) => a.number - b.number)
            .map((row) => ({ ...row, capacity: row.capacity ?? null, guests: [] })),
        ),
      },
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

  it('replaces a 40-table configuration with exactly 30 tables', async () => {
    const { service, rows } = harness();
    for (let number = 1; number <= 40; number++)
      rows.push({
        id: `t${number}`,
        coupleId: 'couple',
        number,
        side: number % 2 ? GuestSide.GROOM : GuestSide.BRIDE,
      });
    const result = await service.configure(
      'couple',
      {
        groomTableNumbers: Array.from({ length: 15 }, (_, index) => index * 2 + 1),
        brideTableNumbers: Array.from({ length: 15 }, (_, index) => index * 2 + 2),
        defaultCapacity: 10,
        replace: true,
      },
      user,
    );
    expect(result).toHaveLength(30);
    expect(rows).toHaveLength(30);
    expect(rows.map((table) => table.number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1),
    );
  });

  it('accepts null capacity and presents null remaining seats', async () => {
    const table = {
      id: 't18',
      coupleId: 'couple',
      number: 18,
      side: GuestSide.BRIDE,
      capacity: 10 as number | null,
    };
    const prisma = {
      couple: { findFirst: jest.fn().mockResolvedValue({ id: 'couple' }) },
      guest: { aggregate: jest.fn().mockResolvedValue({ _sum: { coupons: 7 } }) },
      weddingTable: {
        findFirst: jest.fn().mockResolvedValue(table),
        update: jest.fn(({ data }) => Object.assign(table, data)),
        findMany: jest.fn(() => [{ ...table, guests: [{ coupons: 7 }] }]),
      },
    };
    const service = new TablesService(prisma as never);
    await service.update('couple', 't18', { capacity: null }, user);
    await expect(service.list('couple', user)).resolves.toEqual([
      expect.objectContaining({ capacity: null, occupiedSeats: 7, remainingSeats: null }),
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

  it('preserves the legacy side override rule when delegating to SeatingService', async () => {
    const prisma = {
      couple: { findFirst: jest.fn().mockResolvedValue({ id: 'couple' }) },
      guest: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'g', coupleId: 'couple', side: GuestSide.GROOM, coupons: 1,
        }),
      },
      weddingTable: {
        findFirst: jest.fn().mockResolvedValue({ id: 't', coupleId: 'couple', side: GuestSide.BRIDE }),
      },
    };
    const seating = { assign: jest.fn().mockResolvedValue({ id: 'g' }), unassign: jest.fn() };
    const service = new TablesService(prisma as never, seating as never);
    await expect(service.assign('couple', 'g', { tableId: 't' }, user)).rejects.toThrow(
      'Guest side does not match table side',
    );
    expect(seating.assign).not.toHaveBeenCalled();
    await expect(
      service.assign('couple', 'g', { tableId: 't', allowSideOverride: true }, user),
    ).resolves.toEqual({ id: 'g' });
    expect(seating.assign).toHaveBeenCalledTimes(1);
  });
});
