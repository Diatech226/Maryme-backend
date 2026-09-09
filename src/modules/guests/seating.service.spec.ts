import { BadRequestException, ConflictException } from '@nestjs/common';
import { GuestSide, Prisma, UserRole } from '@prisma/client';
import { SeatingService, TABLE_CAPACITY, TABLE_COUNT } from './seating.service';

const user = { sub: 'u', role: UserRole.COUPLE, coupleId: 'couple' };

describe('SeatingService', () => {
  function harness(coupons = [1, 3]) {
    const state = {
      tables: [
        {
          id: 'table1',
          coupleId: 'couple',
          number: 1,
          capacity: 10,
          side: GuestSide.GROOM as GuestSide,
        },
      ],
      guests: coupons.map((count, index) => ({
        id: `guest${index + 1}`,
        coupleId: 'couple',
        coupons: count,
        tableId: null as string | null,
        tableNumber: null as string | null,
        assignedSeats: [] as string[],
        deletedAt: null,
        createdAt: new Date(index),
      })),
      seats: [] as Array<{
        tableId: string;
        coupleId: string;
        guestId: string;
        seatNumber: number;
      }>,
    };
    const client = () => ({
      weddingTable: {
        findFirst: jest.fn(({ where }) =>
          state.tables.find((t) => t.id === where.id && t.coupleId === where.coupleId),
        ),
        findMany: jest.fn(() =>
          state.tables.map((table) => ({
            ...table,
            seatAssignments: state.seats.filter((seat) => seat.tableId === table.id),
          })),
        ),
        upsert: jest.fn(({ create }) => {
          let table = state.tables.find((row) => row.number === create.number);
          if (!table) {
            const created = { id: `table${create.number}`, ...create };
            state.tables.push(created);
            table = created;
          }
          return table;
        }),
      },
      guest: {
        findMany: jest.fn(({ where }) =>
          state.guests.filter((guest) => where.id.in.includes(guest.id)),
        ),
        findUnique: jest.fn(({ where }) => state.guests.find((guest) => guest.id === where.id)),
        update: jest.fn(({ where, data }) =>
          Object.assign(state.guests.find((g) => g.id === where.id)!, data),
        ),
      },
      tableSeatAssignment: {
        findMany: jest.fn(({ where }) =>
          state.seats.filter(
            (seat) =>
              seat.tableId === where.tableId &&
              (!where.guestId?.not || seat.guestId !== where.guestId.not) &&
              (!where.guestId?.notIn || !where.guestId.notIn.includes(seat.guestId)),
          ),
        ),
        deleteMany: jest.fn(({ where }) => {
          state.seats = state.seats.filter((seat) =>
            where.guestId?.in
              ? !where.guestId.in.includes(seat.guestId)
              : seat.guestId !== where.guestId,
          );
        }),
        create: jest.fn(({ data }) => {
          if (
            state.seats.some(
              (seat) => seat.tableId === data.tableId && seat.seatNumber === data.seatNumber,
            )
          )
            throw new Prisma.PrismaClientKnownRequestError('duplicate', {
              code: 'P2002',
              clientVersion: '6.19.3',
            });
          state.seats.push(data);
          return data;
        }),
      },
    });
    let transactionQueue = Promise.resolve();
    const prisma = {
      couple: { findFirst: jest.fn().mockResolvedValue({ id: 'couple' }) },
      weddingTable: client().weddingTable,
      $transaction: jest.fn((input: unknown) => {
        if (Array.isArray(input)) return Promise.all(input);
        const execute = async () => {
          const snapshot = structuredClone(state);
          try {
            return await (input as (tx: ReturnType<typeof client>) => unknown)(client());
          } catch (error) {
            Object.assign(state, snapshot);
            throw error;
          }
        };
        const result = transactionQueue.then(execute, execute);
        transactionQueue = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      }),
    };
    return { service: new SeatingService(prisma as never), state };
  }

  it('defines exactly 40 tables with 10 physical seats', () => {
    expect(TABLE_COUNT).toBe(40);
    expect(TABLE_CAPACITY).toBe(10);
  });

  it('initializes only missing tables 1..40 idempotently at capacity 10', async () => {
    const { service, state } = harness();
    state.guests[0].assignedSeats = ['legacy-7'];
    state.guests[0].tableNumber = '22';
    await service.initialize('couple', user);
    await service.initialize('couple', user);
    expect(state.tables).toHaveLength(40);
    expect(state.tables.map((table) => table.number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 40 }, (_, index) => index + 1),
    );
    expect(state.tables.every((table) => table.capacity === 10)).toBe(true);
    expect(state.seats).toEqual([]);
    expect(state.guests[0]).toMatchObject({ tableNumber: '22', assignedSeats: ['legacy-7'] });
  });

  it.each([0, 41])('rejects table number %s', async (number) => {
    const { service, state } = harness();
    state.tables[0].number = number;
    await expect(
      service.assign('couple', 'guest1', { tableId: 'table1', autoAssign: true }, user),
    ).rejects.toMatchObject({ response: { code: 'TABLE_NUMBER_OUT_OF_RANGE' } });
  });

  it.each([0, 11])('rejects seat number %s', async (seat) => {
    const { service } = harness();
    await expect(
      service.assign('couple', 'guest1', { tableId: 'table1', seatNumbers: [seat] }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts boundary seats 1 and 10 and reports the real sorted dropdown availability', async () => {
    const { service } = harness([2]);
    await service.assign('couple', 'guest1', { tableId: 'table1', seatNumbers: [10, 1] }, user);
    const availability = await service.availability('couple', user);
    expect(availability.tables[0]).toMatchObject({
      occupiedSeats: [1, 10],
      availableSeats: [2, 3, 4, 5, 6, 7, 8, 9],
      occupiedCount: 2,
      remainingSeats: 8,
    });
  });

  it('assigns multiple seats automatically in first-free order', async () => {
    const { service, state } = harness([1, 3]);
    await service.assign('couple', 'guest1', { tableId: 'table1', seatNumbers: [1] }, user);
    const guest = await service.assign(
      'couple',
      'guest2',
      { tableId: 'table1', autoAssign: true },
      user,
    );
    expect(guest).toMatchObject({ tableNumber: '1', assignedSeats: ['2', '3', '4'] });
    expect(state.seats).toHaveLength(4);
  });

  it('rejects a count mismatch and an already occupied seat without changing data', async () => {
    const { service, state } = harness([1, 3]);
    await service.assign('couple', 'guest1', { tableId: 'table1', seatNumbers: [1] }, user);
    await expect(
      service.assign('couple', 'guest2', { tableId: 'table1', seatNumbers: [2] }, user),
    ).rejects.toMatchObject({ response: { code: 'SEAT_COUNT_MISMATCH' } });
    await expect(
      service.assign('couple', 'guest2', { tableId: 'table1', seatNumbers: [1, 2, 3] }, user),
    ).rejects.toMatchObject({ response: { code: 'SEAT_ALREADY_ASSIGNED' } });
    expect(state.guests[1].tableId).toBeNull();
  });

  it('moves atomically, releases old seats, and unassigns all compatibility fields', async () => {
    const { service, state } = harness([2]);
    state.tables.push({
      id: 'table2',
      coupleId: 'couple',
      number: 2,
      capacity: 10,
      side: GuestSide.BRIDE,
    });
    await service.assign('couple', 'guest1', { tableId: 'table1', seatNumbers: [1, 2] }, user);
    await service.assign('couple', 'guest1', { tableId: 'table2', seatNumbers: [9, 10] }, user);
    expect(state.seats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableId: 'table2', seatNumber: 9 }),
        expect.objectContaining({ tableId: 'table2', seatNumber: 10 }),
      ]),
    );
    expect(state.seats.some((seat) => seat.tableId === 'table1')).toBe(false);
    await service.unassign('couple', 'guest1', user);
    expect(state.guests[0]).toMatchObject({ tableId: null, tableNumber: null, assignedSeats: [] });
    expect(state.seats).toHaveLength(0);
  });

  it('bulk assigns multiple requested seat counts and rejects overflow', async () => {
    const { service, state } = harness([2, 3]);
    await service.bulk(
      'couple',
      'table1',
      { guestIds: ['guest1', 'guest2'], autoAssign: true },
      user,
    );
    expect(state.guests.map((guest) => guest.assignedSeats)).toEqual([
      ['1', '2'],
      ['3', '4', '5'],
    ]);
    state.guests[0].coupons = 8;
    await expect(
      service.bulk('couple', 'table1', { guestIds: ['guest1', 'guest2'], autoAssign: true }, user),
    ).rejects.toMatchObject({ response: { code: 'NOT_ENOUGH_SEATS' } });
  });

  it('fills exactly 10 physical seats for coupon counts 3 + 2 + 5', async () => {
    const { service, state } = harness([3, 2, 5]);
    await service.bulk(
      'couple',
      'table1',
      { guestIds: ['guest1', 'guest2', 'guest3'], autoAssign: true },
      user,
    );
    expect(state.seats).toHaveLength(10);
  });

  it.each(['automatic', 'manual'])('rejects 11 requested physical seats in %s bulk', async (mode) => {
    const { service, state } = harness([3, 3, 3, 2]);
    const guestIds = state.guests.map((guest) => guest.id);
    const request =
      mode === 'automatic'
        ? { guestIds, autoAssign: true }
        : {
            assignments: guestIds.map((guestId, index) => ({
              guestId,
              seatNumbers: Array.from({ length: state.guests[index].coupons }, (_, seat) =>
                Math.min(10, index * 3 + seat + 1),
              ),
            })),
          };
    await expect(service.bulk('couple', 'table1', request, user)).rejects.toMatchObject({
      response: { code: 'NOT_ENOUGH_SEATS' },
    });
  });

  it('supports a bulk selection of 10 contacts when total requested seats fit', async () => {
    const { service, state } = harness(Array(10).fill(1));
    const guestIds = state.guests.map((guest) => guest.id);
    await service.bulk('couple', 'table1', { guestIds, autoAssign: true }, user);
    expect(state.seats.map((seat) => seat.seatNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await expect(service.availability('couple', user)).resolves.toEqual({
      tables: [
        expect.objectContaining({ availableSeats: [], remainingSeats: 0, occupiedCount: 10 }),
      ],
    });
  });

  it('allows only one of two competing requests for the same table/seat', async () => {
    const { service, state } = harness([1, 1]);
    const results = await Promise.allSettled([
      service.assign('couple', 'guest1', { tableId: 'table1', seatNumbers: [1] }, user),
      service.assign('couple', 'guest2', { tableId: 'table1', seatNumbers: [1] }, user),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(state.seats.filter((seat) => seat.seatNumber === 1)).toHaveLength(1);
  });

  it('rolls back an entire manual bulk assignment when one seat conflicts', async () => {
    const { service, state } = harness([1, 1, 1]);
    await service.assign('couple', 'guest1', { tableId: 'table1', seatNumbers: [3] }, user);
    await expect(
      service.bulk(
        'couple',
        'table1',
        {
          assignments: [
            { guestId: 'guest2', seatNumbers: [2] },
            { guestId: 'guest3', seatNumbers: [3] },
          ],
        },
        user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(state.guests[1].tableId).toBeNull();
    expect(state.seats).toHaveLength(1);
  });
});
