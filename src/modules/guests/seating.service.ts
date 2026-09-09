import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GuestSide, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/types/auth-user';
import { assertCoupleAccess } from '../../common/utils/ownership';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignSeatingDto, BulkSeatingDto } from './dto/seating.dto';

export const TABLE_COUNT = 40;
export const TABLE_CAPACITY = 10;

type Tx = Prisma.TransactionClient;
type Assignment = { guestId: string; seats: number[] };

@Injectable()
export class SeatingService {
  constructor(private readonly prisma: PrismaService) {}

  private error(code: string, message: string): never {
    throw new ConflictException({ code, message });
  }

  private async authorize(coupleId: string, user: AuthUser) {
    assertCoupleAccess(user, coupleId);
    const couple = await this.prisma.couple.findFirst({
      where: { id: coupleId, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
      select: { id: true },
    });
    if (!couple) throw new NotFoundException('Couple not found');
  }

  private validateTable(number: number) {
    if (number < 1 || number > TABLE_COUNT)
      throw new BadRequestException({
        code: 'TABLE_NUMBER_OUT_OF_RANGE',
        message: `tableNumber must be between 1 and ${TABLE_COUNT}`,
      });
  }

  private validateSeats(seats: number[]) {
    if (new Set(seats).size !== seats.length)
      this.error('SEAT_ALREADY_ASSIGNED', 'A seat may only occur once in an assignment');
    if (seats.some((seat) => !Number.isInteger(seat) || seat < 1 || seat > TABLE_CAPACITY))
      throw new BadRequestException({
        code: 'SEAT_NUMBER_OUT_OF_RANGE',
        message: `seatNumber must be between 1 and ${TABLE_CAPACITY}`,
      });
  }

  async initialize(coupleId: string, user: AuthUser) {
    await this.authorize(coupleId, user);
    await this.prisma.$transaction(
      Array.from({ length: TABLE_COUNT }, (_, index) => {
        const number = index + 1;
        return this.prisma.weddingTable.upsert({
          where: { coupleId_number: { coupleId, number } },
          create: {
            coupleId,
            number,
            capacity: TABLE_CAPACITY,
            side: number % 2 ? GuestSide.GROOM : GuestSide.BRIDE,
          },
          update: {},
        });
      }),
    );
    return this.availability(coupleId, user);
  }

  async availability(coupleId: string, user: AuthUser) {
    await this.authorize(coupleId, user);
    const tables = await this.prisma.weddingTable.findMany({
      where: { coupleId, number: { gte: 1, lte: TABLE_COUNT } },
      orderBy: { number: 'asc' },
      include: { seatAssignments: { select: { seatNumber: true } } },
    });
    return {
      tables: tables.map((table) => {
        const occupiedSeats = [
          ...new Set(table.seatAssignments.map((seat) => seat.seatNumber)),
        ].sort((a, b) => a - b);
        const availableSeats = Array.from(
          { length: TABLE_CAPACITY },
          (_, index) => index + 1,
        ).filter((seat) => !occupiedSeats.includes(seat));
        return {
          id: table.id,
          number: table.number,
          capacity: TABLE_CAPACITY,
          occupiedSeats,
          availableSeats,
          occupiedCount: occupiedSeats.length,
          remainingSeats: availableSeats.length,
        };
      }),
    };
  }

  async assign(coupleId: string, guestId: string, dto: AssignSeatingDto, user: AuthUser) {
    await this.authorize(coupleId, user);
    if (dto.autoAssign && dto.seatNumbers)
      throw new BadRequestException('Use either seatNumbers or autoAssign=true');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const table = await this.getTable(tx, coupleId, dto.tableId);
        const guest = await this.getGuests(tx, coupleId, [guestId]).then((rows) => rows[0]);
        let seats = dto.seatNumbers;
        if (dto.autoAssign) {
          const occupied = await tx.tableSeatAssignment.findMany({
            where: { tableId: table.id, guestId: { not: guestId } },
            select: { seatNumber: true },
          });
          const used = new Set(occupied.map((row) => row.seatNumber));
          seats = Array.from({ length: TABLE_CAPACITY }, (_, index) => index + 1)
            .filter((seat) => !used.has(seat))
            .slice(0, guest.coupons);
          if (seats.length < guest.coupons)
            this.error(
              used.size === TABLE_CAPACITY ? 'TABLE_FULL' : 'NOT_ENOUGH_SEATS',
              'Not enough seats',
            );
        } else if (!seats) {
          throw new BadRequestException('Provide seatNumbers or autoAssign=true');
        }
        this.validateSeats(seats);
        if (seats.length !== guest.coupons)
          this.error('SEAT_COUNT_MISMATCH', `Guest requires exactly ${guest.coupons} seats`);
        await this.apply(tx, coupleId, table, [{ guestId, seats }]);
        return tx.guest.findUnique({ where: { id: guestId }, include: { table: true } });
      });
    } catch (error) {
      this.mapUniqueError(error);
    }
  }

  async unassign(coupleId: string, guestId: string, user: AuthUser) {
    await this.authorize(coupleId, user);
    return this.prisma.$transaction(async (tx) => {
      await this.getGuests(tx, coupleId, [guestId]);
      await tx.tableSeatAssignment.deleteMany({ where: { coupleId, guestId } });
      return tx.guest.update({
        where: { id: guestId },
        data: { tableId: null, tableNumber: null, assignedSeats: [] },
      });
    });
  }

  async bulk(coupleId: string, tableId: string, dto: BulkSeatingDto, user: AuthUser) {
    await this.authorize(coupleId, user);
    const manual = dto.assignments;
    if ((manual && dto.guestIds) || (!manual && (!dto.guestIds || !dto.autoAssign)))
      throw new BadRequestException('Use assignments, or guestIds with autoAssign=true');
    const guestIds = manual ? manual.map((item) => item.guestId) : dto.guestIds!;
    if (new Set(guestIds).size !== guestIds.length)
      throw new BadRequestException('Duplicate guestId');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const table = await this.getTable(tx, coupleId, tableId);
        const guests = await this.getGuests(tx, coupleId, guestIds);
        let assignments: Assignment[];
        if (manual) {
          assignments = manual.map((item) => ({ guestId: item.guestId, seats: item.seatNumbers }));
          for (const assignment of assignments) this.validateSeats(assignment.seats);
          const allSeats = assignments.flatMap((assignment) => assignment.seats);
          if (new Set(allSeats).size !== allSeats.length)
            this.error(
              'SEAT_ALREADY_ASSIGNED',
              'A seat cannot be assigned twice in a bulk request',
            );
          for (const assignment of assignments) {
            const guest = guests.find((row) => row.id === assignment.guestId)!;
            if (assignment.seats.length !== guest.coupons)
              this.error(
                'SEAT_COUNT_MISMATCH',
                `${guest.id} requires exactly ${guest.coupons} seats`,
              );
          }
        } else {
          const occupied = await tx.tableSeatAssignment.findMany({
            where: { tableId, guestId: { notIn: guestIds } },
            select: { seatNumber: true },
          });
          const used = new Set(occupied.map((row) => row.seatNumber));
          const free = Array.from({ length: TABLE_CAPACITY }, (_, index) => index + 1).filter(
            (seat) => !used.has(seat),
          );
          const requested = guests.reduce((sum, guest) => sum + guest.coupons, 0);
          if (requested > free.length)
            this.error(free.length === 0 ? 'TABLE_FULL' : 'NOT_ENOUGH_SEATS', 'Not enough seats');
          let cursor = 0;
          assignments = guestIds.map((guestId) => {
            const guest = guests.find((row) => row.id === guestId)!;
            const seats = free.slice(cursor, cursor + guest.coupons);
            cursor += guest.coupons;
            return { guestId, seats };
          });
        }
        await this.apply(tx, coupleId, table, assignments);
        return tx.guest.findMany({
          where: { id: { in: guestIds } },
          orderBy: { createdAt: 'asc' },
        });
      });
    } catch (error) {
      this.mapUniqueError(error);
    }
  }

  private async getTable(tx: Tx, coupleId: string, tableId: string) {
    const table = await tx.weddingTable.findFirst({ where: { id: tableId, coupleId } });
    if (!table) throw new NotFoundException('Wedding table not found');
    this.validateTable(table.number);
    return table;
  }

  private async getGuests(tx: Tx, coupleId: string, guestIds: string[]) {
    const guests = await tx.guest.findMany({
      where: {
        id: { in: guestIds },
        coupleId,
        OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }],
      },
    });
    if (guests.length !== guestIds.length) throw new NotFoundException('Guest not found');
    return guests;
  }

  private async apply(
    tx: Tx,
    coupleId: string,
    table: { id: string; number: number },
    assignments: Assignment[],
  ) {
    const guestIds = assignments.map((assignment) => assignment.guestId);
    await tx.tableSeatAssignment.deleteMany({ where: { guestId: { in: guestIds } } });
    for (const assignment of assignments)
      for (const seatNumber of assignment.seats)
        await tx.tableSeatAssignment.create({
          data: { coupleId, tableId: table.id, guestId: assignment.guestId, seatNumber },
        });
    for (const assignment of assignments)
      await tx.guest.update({
        where: { id: assignment.guestId },
        data: {
          tableId: table.id,
          tableNumber: String(table.number),
          assignedSeats: assignment.seats.map(String),
        },
      });
  }

  private mapUniqueError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      this.error('SEAT_ALREADY_ASSIGNED', 'One or more seats have just been assigned');
    throw error;
  }
}
