import { ValidationPipe } from '@nestjs/common';
import { GuestCategory, GuestSide } from '@prisma/client';
import { CreateGuestDto, ImportGuestRowDto, UpdateGuestDto } from './guest.dto';

describe('Guest DTO contract', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const create = {
    firstName: 'Awa',
    lastName: 'Diallo',
    side: GuestSide.GROOM,
    coupons: 3,
    category: GuestCategory.FRIENDS,
  };

  const transform = (metatype: new () => object, value: object) =>
    pipe.transform(value, { type: 'body', metatype });

  it.each(['assignedSeats', 'tableId', 'tableNumber'] as const)(
    'rejects generic CreateGuestDto seating field %s',
    async (field) => {
      const value = field === 'assignedSeats' ? [] : field === 'tableNumber' ? 8 : 'table-id';
      await expect(transform(CreateGuestDto, { ...create, [field]: value })).rejects.toMatchObject({
        status: 400,
      });
    },
  );

  it.each(['assignedSeats', 'tableId', 'tableNumber'] as const)(
    'rejects generic UpdateGuestDto seating field %s',
    async (field) => {
      const value = field === 'assignedSeats' ? [] : field === 'tableNumber' ? 8 : 'table-id';
      await expect(transform(UpdateGuestDto, { [field]: value })).rejects.toMatchObject({
        status: 400,
      });
    },
  );

  it.each([1, 10])('accepts coupons=%i for a new guest', async (coupons) => {
    await expect(transform(CreateGuestDto, { ...create, coupons })).resolves.toMatchObject({
      coupons,
    });
  });

  it('accepts the documented generic guest payload', async () => {
    await expect(transform(CreateGuestDto, create)).resolves.toMatchObject(create);
  });

  it.each([CreateGuestDto, UpdateGuestDto, ImportGuestRowDto])(
    'rejects coupons=11 through %p',
    async (metatype) => {
      const payload = metatype === UpdateGuestDto ? { coupons: 11 } : { ...create, coupons: 11 };
      await expect(transform(metatype, payload)).rejects.toMatchObject({ status: 400 });
    },
  );

  it('keeps legacy import table columns without turning them into generic Guest fields', async () => {
    await expect(
      transform(ImportGuestRowDto, { ...create, tableId: 'legacy-table', tableNumber: 8 }),
    ).resolves.toMatchObject({ tableId: 'legacy-table', tableNumber: 8 });
  });
});
