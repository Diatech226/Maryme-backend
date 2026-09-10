import { ensureStandardWeddingTables, STANDARD_TABLE_CAPACITY } from './standard-wedding-tables';

describe('Maryme domain contract: standard wedding tables', () => {
  function database(existing: number[] = []) {
    const tables = new Map(existing.map((number) => [number, { number, capacity: 10 }]));
    const upsert = jest.fn(
      async ({ create }: { create: { number: number; capacity: number }; update: object }) => {
        if (!tables.has(create.number)) tables.set(create.number, create);
        return tables.get(create.number);
      },
    );
    return { tables, db: { weddingTable: { upsert } }, upsert };
  }

  it.each([
    { initial: [], label: '0→40' },
    { initial: Array.from({ length: 39 }, (_, index) => index + 1), label: '39→40' },
    { initial: Array.from({ length: 40 }, (_, index) => index + 1), label: '40→40' },
  ])('is idempotent for $label without deleting anything', async ({ initial }) => {
    const { tables, db, upsert } = database(initial);
    await ensureStandardWeddingTables('couple-1', db as never);
    expect([...tables.keys()].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 40 }, (_, index) => index + 1),
    );
    expect([...tables.values()].every((table) => table.capacity === 10)).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(40);
    expect(upsert.mock.calls.every(([argument]) => Object.keys(argument.update).length === 0)).toBe(
      true,
    );
  });

  it('freezes the physical capacity at ten', () => {
    expect(STANDARD_TABLE_CAPACITY).toBe(10);
  });
});
