import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import { ResetCouplePasswordDto, UpdateCoupleAccountDto, UpdateCoupleDto } from './couple.dto';

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

  it('accepts official invitation text fields while preserving the strict read-only boundary', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    await expect(
      pipe.transform(
        {
          invitationIntroText: 'Nous avons la joie de vous inviter',
          invitationFooterText: 'Merci',
        },
        { type: 'body', metatype: UpdateCoupleDto },
      ),
    ).resolves.toMatchObject({
      invitationIntroText: 'Nous avons la joie de vous inviter',
      invitationFooterText: 'Merci',
    });
    for (const field of ['id', 'status', 'createdAt']) {
      await expect(
        pipe.transform({ [field]: 'read-only' }, { type: 'body', metatype: UpdateCoupleDto }),
      ).rejects.toThrow();
    }
  });
});
