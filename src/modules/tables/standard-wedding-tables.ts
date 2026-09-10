import { GuestSide, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const STANDARD_TABLE_COUNT = 40;
export const STANDARD_TABLE_CAPACITY = 10;

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Adds only missing standard tables. Existing tables, guests, legacy mirrors,
 * and seat assignments are deliberately never updated or removed.
 */
export async function ensureStandardWeddingTables(coupleId: string, db: Db) {
  for (let index = 0; index < STANDARD_TABLE_COUNT; index += 1) {
    const number = index + 1;
    await db.weddingTable.upsert({
      where: { coupleId_number: { coupleId, number } },
      create: {
        coupleId,
        number,
        capacity: STANDARD_TABLE_CAPACITY,
        side: number % 2 ? GuestSide.GROOM : GuestSide.BRIDE,
      },
      update: {},
    });
  }
}
