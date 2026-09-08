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
import {
  AssignGuestTableDto,
  BulkWeddingTablesDto,
  ConfigureWeddingTablesDto,
  CreateWeddingTableDto,
  GenerateWeddingTablesDto,
  UpdateWeddingTableDto,
} from './dto/table.dto';

@Injectable()
export class TablesService {
  constructor(private readonly prisma: PrismaService) {}
  private async couple(coupleId: string, user: AuthUser) {
    assertCoupleAccess(user, coupleId);
    const couple = await this.prisma.couple.findFirst({
      where: { id: coupleId, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
    });
    if (!couple) throw new NotFoundException('Couple not found');
  }
  private async table(coupleId: string, tableId: string, user: AuthUser) {
    await this.couple(coupleId, user);
    const table = await this.prisma.weddingTable.findFirst({ where: { id: tableId, coupleId } });
    if (!table) throw new NotFoundException('Wedding table not found');
    return table;
  }
  private occupied(table: { guests: { coupons: number }[] }) {
    return table.guests.reduce((sum, guest) => sum + guest.coupons, 0);
  }
  private present<T extends { capacity: number | null; guests: { coupons: number }[] }>(table: T) {
    const occupiedSeats = this.occupied(table);
    return {
      ...table,
      occupiedSeats,
      remainingSeats: table.capacity == null ? null : table.capacity - occupiedSeats,
    };
  }
  async list(coupleId: string, user: AuthUser) {
    await this.couple(coupleId, user);
    const rows = await this.prisma.weddingTable.findMany({
      where: { coupleId },
      orderBy: { number: 'asc' },
      include: {
        guests: {
          where: { OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
          select: { coupons: true },
        },
      },
    });
    return rows.map((row) => this.present(row));
  }
  async create(coupleId: string, dto: CreateWeddingTableDto, user: AuthUser) {
    await this.couple(coupleId, user);
    try {
      return await this.prisma.weddingTable.create({ data: { ...dto, coupleId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Table number already exists for this couple');
      throw error;
    }
  }
  async bulk(coupleId: string, dto: BulkWeddingTablesDto, user: AuthUser) {
    await this.couple(coupleId, user);
    if (new Set(dto.tables.map((table) => table.number)).size !== dto.tables.length)
      throw new ConflictException('Duplicate table number in request');
    const tables = dto.tables.map((table) => ({
      ...table,
      capacity: table.capacity ?? dto.defaultCapacity,
    }));
    if (dto.replace) return this.replace(coupleId, tables);
    return this.prisma.$transaction(
      tables.map((table) =>
        this.prisma.weddingTable.upsert({
          where: { coupleId_number: { coupleId, number: table.number } },
          create: { ...table, coupleId },
          update: { side: table.side, capacity: table.capacity },
        }),
      ),
    );
  }
  async configure(coupleId: string, dto: ConfigureWeddingTablesDto, user: AuthUser) {
    await this.couple(coupleId, user);
    const groom = dto.groomTableNumbers ?? dto.groomTables?.numbers;
    const bride = dto.brideTableNumbers ?? dto.brideTables?.numbers;
    if (!groom || !bride)
      throw new BadRequestException({
        code: 'INVALID_TABLE_CONFIGURATION',
        message: 'Both groom and bride table numbers are required',
      });
    if (dto.groomTables && dto.groomTables.count !== groom.length)
      throw new BadRequestException({
        code: 'INVALID_TABLE_CONFIGURATION',
        message: 'groomTables.count must match numbers length',
      });
    if (dto.brideTables && dto.brideTables.count !== bride.length)
      throw new BadRequestException({
        code: 'INVALID_TABLE_CONFIGURATION',
        message: 'brideTables.count must match numbers length',
      });
    const all = [...groom, ...bride];
    if (new Set(all).size !== all.length)
      throw new ConflictException({
        code: 'DUPLICATE_TABLE_NUMBER',
        message: 'A table number can only belong to one side',
      });
    const tables: CreateWeddingTableDto[] = [
      ...groom.map((number) => ({ number, side: GuestSide.GROOM, capacity: dto.defaultCapacity })),
      ...bride.map((number) => ({ number, side: GuestSide.BRIDE, capacity: dto.defaultCapacity })),
    ];
    if (dto.replace === false) {
      await this.bulk(coupleId, { tables }, user);
    } else {
      await this.replace(coupleId, tables);
    }
    return this.list(coupleId, user);
  }
  private async replace(coupleId: string, tables: CreateWeddingTableDto[]) {
    return this.prisma.$transaction(async (tx) => {
      const retained = tables.map((table) => table.number);
      const existing = await tx.weddingTable.findMany({
        where: { coupleId },
        include: {
          guests: {
            where: { OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
            select: { coupons: true },
          },
        },
      });
      const removed = existing.filter((table) => !retained.includes(table.number));
      const used = removed.find((table) => table.guests.length > 0);
      if (used)
        throw new ConflictException({
          code: 'TABLE_IN_USE',
          message: `Table ${used.number} has assigned guests`,
          tableNumber: used.number,
          guestCount: used.guests.length,
        });
      for (const next of tables) {
        const current = existing.find((table) => table.number === next.number);
        if (!current?.guests.length) continue;
        if (current.side !== next.side)
          throw new ConflictException({
            code: 'TABLE_SIDE_IN_USE',
            message: `Table ${next.number} cannot change side while guests are assigned`,
            tableNumber: next.number,
            guestCount: current.guests.length,
          });
        const occupied = this.occupied(current);
        if (next.capacity != null && occupied > next.capacity)
          throw new ConflictException({
            code: 'TABLE_CAPACITY_EXCEEDED',
            message: `Table ${next.number} capacity is below its occupied seats`,
            tableNumber: next.number,
            occupiedSeats: occupied,
          });
      }
      await tx.weddingTable.deleteMany({ where: { coupleId, number: { notIn: retained } } });
      for (const table of tables)
        await tx.weddingTable.upsert({
          where: { coupleId_number: { coupleId, number: table.number } },
          create: { ...table, coupleId },
          update: { side: table.side, capacity: table.capacity },
        });
      return tx.weddingTable.findMany({ where: { coupleId }, orderBy: { number: 'asc' } });
    });
  }
  async generate(coupleId: string, dto: GenerateWeddingTablesDto, user: AuthUser) {
    const generated = new Map<number, CreateWeddingTableDto>();
    for (const rule of dto.rules) {
      if (rule.from > rule.to || rule.to > dto.totalTables)
        throw new BadRequestException('Invalid table generation range');
      for (let number = rule.from; number <= rule.to; number++) {
        const side = rule.side ?? (number % 2 ? rule.oddSide : rule.evenSide);
        if (!side) throw new BadRequestException(`No side configured for table ${number}`);
        if (generated.has(number))
          throw new BadRequestException(`Overlapping rule for table ${number}`);
        generated.set(number, { number, side, capacity: rule.capacity });
      }
    }
    if (
      generated.size !== dto.totalTables ||
      [...generated.keys()].some((number) => number < 1 || number > dto.totalTables)
    )
      throw new BadRequestException(
        'Rules must define every table from 1 to totalTables exactly once',
      );
    await this.couple(coupleId, user);
    return this.prisma.$transaction(async (tx) => {
      if (dto.replace) {
        if (await tx.guest.count({ where: { coupleId, tableId: { not: null } } }))
          throw new ConflictException('Cannot replace tables while guests are assigned');
        await tx.weddingTable.deleteMany({ where: { coupleId } });
      }
      for (const table of generated.values())
        await tx.weddingTable.upsert({
          where: { coupleId_number: { coupleId, number: table.number } },
          create: { ...table, coupleId },
          update: { side: table.side, capacity: table.capacity },
        });
      return tx.weddingTable.findMany({ where: { coupleId }, orderBy: { number: 'asc' } });
    });
  }
  async update(coupleId: string, tableId: string, dto: UpdateWeddingTableDto, user: AuthUser) {
    await this.table(coupleId, tableId, user);
    if (dto.capacity !== undefined) {
      const seats =
        (
          await this.prisma.guest.aggregate({
            where: { tableId, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
            _sum: { coupons: true },
          })
        )._sum.coupons ?? 0;
      if (dto.capacity < seats)
        throw new ConflictException('Capacity is lower than occupied seats');
    }
    return this.prisma.weddingTable.update({ where: { id: tableId }, data: dto });
  }
  async remove(coupleId: string, tableId: string, user: AuthUser) {
    await this.table(coupleId, tableId, user);
    if (await this.prisma.guest.count({ where: { tableId } }))
      throw new ConflictException('Cannot delete a table with assigned guests');
    await this.prisma.weddingTable.delete({ where: { id: tableId } });
  }
  async assign(coupleId: string, guestId: string, dto: AssignGuestTableDto, user: AuthUser) {
    await this.couple(coupleId, user);
    const guest = await this.prisma.guest.findFirst({
      where: { id: guestId, coupleId, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
    });
    if (!guest) throw new NotFoundException('Guest not found');
    if (dto.tableId === null)
      return this.prisma.guest.update({
        where: { id: guestId },
        data: { tableId: null, tableNumber: null },
      });
    const table = await this.prisma.weddingTable.findFirst({
      where: { id: dto.tableId, coupleId },
      include: {
        guests: {
          where: {
            id: { not: guestId },
            OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }],
          },
          select: { coupons: true },
        },
      },
    });
    if (!table) throw new NotFoundException('Wedding table not found for this couple');
    if (table.side !== guest.side && !dto.allowSideOverride)
      throw new ConflictException('Guest side does not match table side');
    if (table.capacity != null && this.occupied(table) + guest.coupons > table.capacity)
      throw new ConflictException('Table capacity exceeded');
    return this.prisma.guest.update({
      where: { id: guestId },
      data: { tableId: table.id, tableNumber: String(table.number) },
      include: { table: true },
    });
  }
  async summary(coupleId: string, user: AuthUser) {
    const tables = await this.list(coupleId, user);
    const capacities = tables.filter((table) => table.capacity != null);
    const totalCapacity = capacities.reduce((sum, table) => sum + table.capacity!, 0);
    const occupiedSeats = tables.reduce((sum, table) => sum + table.occupiedSeats, 0);
    return {
      totalTables: tables.length,
      groomTables: tables.filter((t) => t.side === GuestSide.GROOM).length,
      brideTables: tables.filter((t) => t.side === GuestSide.BRIDE).length,
      totalCapacity: capacities.length === tables.length ? totalCapacity : null,
      occupiedSeats,
      remainingSeats: capacities.length === tables.length ? totalCapacity - occupiedSeats : null,
    };
  }
}
