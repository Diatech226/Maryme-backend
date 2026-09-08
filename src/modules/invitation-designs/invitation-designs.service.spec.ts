import { BadRequestException } from '@nestjs/common';
import { InvitationDesignMode, UserRole } from '@prisma/client';
import { InvitationDesignsService } from './invitation-designs.service';

describe('InvitationDesignsService uploaded workflow', () => {
  const user = { sub: 'user', role: UserRole.COUPLE, coupleId: 'couple' };
  const generated = {
    id: 'generated',
    coupleId: 'couple',
    name: 'Generated',
    mode: InvitationDesignMode.GENERATED,
    templateKey: 'classic',
    backgroundObjectKey: null,
    isActive: true,
  };

  function harness() {
    const rows: Array<Record<string, any>> = [{ ...generated }];
    const invitationDesign = {
      findFirst: jest.fn(({ where }) => rows.find((row) => row.id === where.id)),
      findMany: jest.fn(async () => rows),
      create: jest.fn(({ data }) => {
        const row = {
          id: `uploaded-${rows.length}`,
          backgroundObjectKey: null,
          isActive: false,
          ...data,
        };
        rows.push(row);
        return row;
      }),
      update: jest.fn(({ where, data }) => {
        const row = rows.find((candidate) => candidate.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(({ where, data }) => {
        rows
          .filter((row) => row.coupleId === where.coupleId && row.isActive)
          .forEach((row) => Object.assign(row, data));
        return { count: 1 };
      }),
      delete: jest.fn(
        ({ where }) =>
          rows.splice(
            rows.findIndex((row) => row.id === where.id),
            1,
          )[0],
      ),
    };
    const prisma = {
      couple: { findFirst: jest.fn().mockResolvedValue({ id: 'couple' }) },
      invitationDesign,
      invitationArtifact: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((operations) => Promise.all(operations)),
    };
    const storage = {
      put: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue({ body: Buffer.from('png'), contentType: 'image/png' }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const service = new InvitationDesignsService(
      prisma as never,
      { record: jest.fn() } as never,
      storage as never,
      { get: jest.fn().mockReturnValue(1024) } as never,
    );
    return { service, rows, storage, invitationDesign };
  }

  const dto = {
    name: 'Canva',
    mode: InvitationDesignMode.UPLOADED,
    overlayConfig: {},
  };

  it('keeps an upload draft inactive and preserves the active design when activation is refused', async () => {
    const { service, rows, invitationDesign } = harness();
    const draft = await service.create('couple', dto, user);
    expect(draft).toMatchObject({ isActive: false, hasBackground: false });
    expect(draft).not.toHaveProperty('backgroundObjectKey');

    await expect(service.activate('couple', draft.id, user)).rejects.toMatchObject({
      response: {
        code: 'INVITATION_BACKGROUND_MISSING',
        message: 'Upload a background before activating this design',
      },
    });
    expect(rows.find((row) => row.id === 'generated')?.isActive).toBe(true);
    expect(invitationDesign.updateMany).not.toHaveBeenCalled();
  });

  it('uploads, downloads, and only then activates an imported design', async () => {
    const { service, rows, storage } = harness();
    const draft = await service.create('couple', dto, user);
    const file = {
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      mimetype: 'image/png',
      size: 8,
      originalname: 'card.png',
    };
    const uploaded = await service.background('couple', draft.id, file, user);
    expect(uploaded.hasBackground).toBe(true);
    expect(uploaded).not.toHaveProperty('backgroundObjectKey');
    await expect(service.downloadBackground('couple', draft.id, user)).resolves.toEqual(
      expect.objectContaining({ contentType: 'image/png' }),
    );

    const active = await service.activate('couple', draft.id, user);
    expect(active).toMatchObject({ isActive: true, hasBackground: true });
    expect(rows.find((row) => row.id === 'generated')?.isActive).toBe(false);
    expect(storage.put).toHaveBeenCalledTimes(1);
  });

  it('leaves the draft and current active design untouched when storage upload fails', async () => {
    const { service, rows, storage, invitationDesign } = harness();
    const draft = await service.create('couple', dto, user);
    storage.put.mockRejectedValueOnce(new Error('storage unavailable'));
    const file = {
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      mimetype: 'image/png',
      size: 8,
      originalname: 'card.png',
    };
    await expect(service.background('couple', draft.id, file, user)).rejects.toThrow(
      'storage unavailable',
    );
    expect(invitationDesign.update).not.toHaveBeenCalled();
    expect(rows.find((row) => row.id === draft.id)).toMatchObject({
      backgroundObjectKey: null,
      isActive: false,
    });
    expect(rows.find((row) => row.id === 'generated')?.isActive).toBe(true);
  });

  it('lists, updates, and deletes incomplete uploaded designs without exposing keys', async () => {
    const { service } = harness();
    const first = await service.create('couple', dto, user);
    await service.create('couple', { ...dto, name: 'Second' }, user);
    expect(await service.list('couple', user)).toEqual(
      expect.arrayContaining([expect.objectContaining({ hasBackground: false })]),
    );
    expect(await service.update('couple', first.id, { name: 'Renamed' }, user)).toMatchObject({
      name: 'Renamed',
      hasBackground: false,
    });
    await expect(service.remove('couple', first.id, user)).resolves.toBeUndefined();
    await expect(service.activate('couple', 'uploaded-2', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
