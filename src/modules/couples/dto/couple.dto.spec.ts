import 'reflect-metadata';
import { validate } from 'class-validator';
import { ResetCouplePasswordDto, UpdateCoupleAccountDto } from './couple.dto';

describe('couple account DTOs', () => {
  it('accepts a six-character couple password and rejects five characters', async () => {
    expect(
      await validate(Object.assign(new ResetCouplePasswordDto(), { password: '123456' })),
    ).toHaveLength(0);
    expect(
      await validate(Object.assign(new ResetCouplePasswordDto(), { password: '12345' })),
    ).not.toHaveLength(0);
  });

  it('accepts optional account email and international phone input', async () => {
    const dto = Object.assign(new UpdateCoupleAccountDto(), {
      email: 'couple@example.com',
      phone: '+226 70 00 00 00',
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
