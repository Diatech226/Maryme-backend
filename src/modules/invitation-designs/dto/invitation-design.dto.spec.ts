import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateInvitationDesignDto } from './invitation-design.dto';

const valid = {
  name: 'Classique',
  mode: 'GENERATED',
  templateKey: 'classic',
  overlayConfig: { qr: { enabled: true, x: 0.1, y: 0.9 } },
};

describe('CreateInvitationDesignDto', () => {
  const errors = (value: unknown) =>
    validate(plainToInstance(CreateInvitationDesignDto, value), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it('accepts the documented generated design contract', async () => {
    await expect(errors(valid)).resolves.toHaveLength(0);
  });

  it('requires a non-empty name', async () => {
    const { name: _name, ...missing } = valid;
    await expect(errors(missing)).resolves.not.toHaveLength(0);
    await expect(errors({ ...valid, name: '' })).resolves.not.toHaveLength(0);
  });

  it('strictly validates nested overlays and rejects unknown fields', async () => {
    await expect(
      errors({ ...valid, overlayConfig: { qr: { enabled: true, x: 2, y: 0.5 } } }),
    ).resolves.not.toHaveLength(0);
    await expect(
      errors({ ...valid, overlayConfig: { qr: { enabled: true, x: '0.2', y: 0.5 } } }),
    ).resolves.not.toHaveLength(0);
    await expect(
      errors({ ...valid, backgroundObjectKey: 'private/key' }),
    ).resolves.not.toHaveLength(0);
    await expect(
      errors({ ...valid, overlayConfig: { qr: { enabled: true, x: 0.2, y: 0.5, secret: true } } }),
    ).resolves.not.toHaveLength(0);
  });
});
