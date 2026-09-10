import { UserRole } from '@prisma/client';
import { WeddingMediaService } from './wedding-media.service';

describe('WeddingMediaService', () => {
  const user = { sub: 'user-a', role: UserRole.COUPLE, coupleId: 'couple-a' };
  const now = new Date('2026-01-01T00:00:00Z');
  const files = {
    jpeg: {
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      size: 4,
      mimetype: 'image/jpeg',
      originalname: 'invitation.jpg',
    },
    png: {
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      size: 8,
      mimetype: 'image/png',
      originalname: 'programme.png',
    },
    webp: {
      buffer: Buffer.from('RIFFxxxxWEBP'),
      size: 12,
      mimetype: 'image/webp',
      originalname: 'info.webp',
    },
  };

  function harness() {
    let sequence = 0;
    const rows: any[] = [];
    const weddingMedia = {
      findMany: jest.fn(async ({ where }) =>
        rows
          .filter((row) => row.coupleId === where.coupleId)
          .sort((left, right) => left.slot - right.slot),
      ),
      findFirst: jest.fn(async ({ where }) =>
        rows.find((row) => row.id === where.id && row.coupleId === where.coupleId),
      ),
      findUnique: jest.fn(async ({ where }) => {
        const key = where.coupleId_slot;
        return rows.find((row) => row.coupleId === key.coupleId && row.slot === key.slot);
      }),
      count: jest.fn(
        async ({ where }) => rows.filter((row) => row.coupleId === where.coupleId).length,
      ),
      create: jest.fn(async ({ data }) => {
        const row = {
          id: data.id ?? `media-${++sequence}`,
          width: null,
          height: null,
          ...data,
          createdAt: data.createdAt ?? now,
          updatedAt: data.updatedAt ?? now,
        };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        Object.assign(row, data, { updatedAt: now });
        return row;
      }),
      delete: jest.fn(async ({ where }) => {
        const index = rows.findIndex((row) => row.id === where.id);
        return rows.splice(index, 1)[0];
      }),
    };
    const prisma = {
      couple: {
        findFirst: jest.fn(async ({ where }) => (where.id === 'missing' ? null : { id: where.id })),
      },
      weddingMedia,
    };
    const objects = new Map<string, { body: Buffer; contentType: string }>();
    const storage = {
      put: jest.fn(async (key, body, contentType) => objects.set(key, { body, contentType })),
      get: jest.fn(async (key) => objects.get(key)),
      delete: jest.fn(async (key) => void objects.delete(key)),
    };
    const audit = { record: jest.fn() };
    const service = new WeddingMediaService(
      prisma as never,
      storage as never,
      { get: jest.fn().mockReturnValue(20) } as never,
      audit as never,
    );
    return { service, rows, storage, weddingMedia, objects, audit };
  }

  it.each([
    [1, 'Faire-part principal', files.jpeg],
    [2, 'Programme', files.png],
    [3, 'Informations complémentaires', files.webp],
  ])('uploads supported image into slot %i', async (slot, label, file) => {
    const { service } = harness();
    await expect(service.upload('couple-a', { slot, label }, file, user)).resolves.toMatchObject({
      slot,
      label,
      mimeType: file.mimetype,
      hasFile: true,
    });
  });

  it('rejects slot 4 with a structured error', async () => {
    const { service } = harness();
    await expect(
      service.upload('couple-a', { slot: 4, label: 'Invalid' }, files.jpeg, user),
    ).rejects.toMatchObject({ response: { code: 'WEDDING_MEDIA_SLOT_INVALID' } });
  });

  it('enforces the absolute three-media limit', async () => {
    const { service, rows, weddingMedia } = harness();
    rows.push(...[1, 2, 3].map((slot) => ({ coupleId: 'couple-a', slot })));
    weddingMedia.findUnique.mockResolvedValueOnce(undefined);
    await expect(
      service.upload('couple-a', { slot: 1, label: 'Fourth' }, files.jpeg, user),
    ).rejects.toMatchObject({ response: { code: 'WEDDING_MEDIA_LIMIT_REACHED' } });
  });

  it.each([
    [
      { ...files.jpeg, buffer: Buffer.from('plain text'), mimetype: 'image/jpeg' },
      'WEDDING_MEDIA_UNSUPPORTED_TYPE',
    ],
    [{ ...files.jpeg, size: 21 }, 'WEDDING_MEDIA_TOO_LARGE'],
  ])('rejects invalid uploads with %s', async (file, code) => {
    const { service } = harness();
    await expect(
      service.upload('couple-a', { slot: 1, label: 'Card' }, file, user),
    ).rejects.toMatchObject({ response: { code } });
  });

  it('replaces safely, reads the new GridFS object, and deletes the old object last', async () => {
    const { service, rows, storage, objects } = harness();
    const first = await service.upload('couple-a', { slot: 1, label: 'Old' }, files.jpeg, user);
    const oldKey = rows[0].objectKey;
    const replacement = await service.upload(
      'couple-a',
      { slot: 1, label: 'New' },
      files.png,
      user,
    );
    expect(replacement.id).toBe(first.id);
    expect(objects.has(oldKey)).toBe(false);
    expect(storage.put.mock.invocationCallOrder.at(-1)).toBeLessThan(
      storage.delete.mock.invocationCallOrder.at(-1)!,
    );
    expect(rows[0]).toMatchObject({ width: null, height: null });
    await expect(service.download('couple-a', first.id, user)).resolves.toMatchObject({
      body: files.png.buffer,
      contentType: 'image/png',
      sizeBytes: files.png.size,
    });
  });

  it('replaces an occupied slot without treating it as a fourth card', async () => {
    const { service, rows, weddingMedia } = harness();
    for (const [slot, label, file] of [
      [1, 'Main', files.jpeg],
      [2, 'Programme', files.png],
      [3, 'Info', files.webp],
    ] as const)
      await service.upload('couple-a', { slot, label }, file, user);

    await expect(
      service.upload('couple-a', { slot: 1, label: 'Replacement' }, files.png, user),
    ).resolves.toMatchObject({ slot: 1, label: 'Replacement' });
    expect(rows).toHaveLength(3);
    expect(weddingMedia.count).toHaveBeenCalledTimes(3);
  });

  it('lists safe metadata sorted by slot without exposing objectKey', async () => {
    const { service } = harness();
    await service.upload('couple-a', { slot: 3, label: 'Info' }, files.webp, user);
    await service.upload('couple-a', { slot: 1, label: 'Main' }, files.jpeg, user);
    await service.upload('couple-a', { slot: 2, label: 'Programme' }, files.png, user);
    const result = await service.list('couple-a', user);
    expect(result[0]).not.toHaveProperty('objectKey');
    expect(result.map(({ slot }) => slot)).toEqual([1, 2, 3]);
    expect(result.every(({ hasFile }) => hasFile)).toBe(true);
  });

  it('renames a card and moves it to an available slot', async () => {
    const { service } = harness();
    const media = await service.upload('couple-a', { slot: 1, label: 'Old' }, files.jpeg, user);
    await expect(
      service.update('couple-a', media.id, { slot: 2, label: 'Programme' }, user),
    ).resolves.toMatchObject({ slot: 2, label: 'Programme' });
  });

  it('rejects moving a card to an occupied slot', async () => {
    const { service } = harness();
    const first = await service.upload('couple-a', { slot: 1, label: 'Main' }, files.jpeg, user);
    await service.upload('couple-a', { slot: 2, label: 'Programme' }, files.png, user);
    await expect(service.update('couple-a', first.id, { slot: 2 }, user)).rejects.toMatchObject({
      response: { code: 'WEDDING_MEDIA_SLOT_OCCUPIED' },
    });
  });

  it('deletes both metadata and the GridFS object', async () => {
    const { service, rows, storage, audit } = harness();
    const media = await service.upload('couple-a', { slot: 3, label: 'Info' }, files.webp, user);
    const key = rows[0].objectKey;
    await service.remove('couple-a', media.id, user);
    expect(rows).toHaveLength(0);
    expect(storage.delete).toHaveBeenCalledWith(key);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WEDDING_MEDIA_DELETED', entityId: media.id }),
    );
  });

  it('restores metadata and does not audit deletion when GridFS deletion fails', async () => {
    const { service, rows, storage, audit } = harness();
    const media = await service.upload('couple-a', { slot: 1, label: 'Main' }, files.jpeg, user);
    storage.delete.mockRejectedValueOnce(new Error('GridFS unavailable'));

    await expect(service.remove('couple-a', media.id, user)).rejects.toThrow('GridFS unavailable');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: media.id, coupleId: 'couple-a', slot: 1 });
    expect(audit.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WEDDING_MEDIA_DELETED' }),
    );
  });

  it('removes the new object when replacement metadata update fails', async () => {
    const { service, rows, storage, objects, weddingMedia } = harness();
    await service.upload('couple-a', { slot: 1, label: 'Old' }, files.jpeg, user);
    const oldKey = rows[0].objectKey;
    weddingMedia.update.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      service.upload('couple-a', { slot: 1, label: 'New' }, files.png, user),
    ).rejects.toThrow('database unavailable');
    expect(objects.size).toBe(1);
    expect(objects.has(oldKey)).toBe(true);
    expect(storage.delete).not.toHaveBeenCalledWith(oldKey);
  });

  it('keeps the replacement active when old GridFS cleanup fails', async () => {
    const { service, rows, storage } = harness();
    const media = await service.upload('couple-a', { slot: 1, label: 'Old' }, files.jpeg, user);
    storage.delete.mockRejectedValueOnce(new Error('old object locked'));

    await expect(
      service.upload('couple-a', { slot: 1, label: 'New' }, files.png, user),
    ).resolves.toMatchObject({ id: media.id, label: 'New', mimeType: 'image/png' });
    expect(rows).toHaveLength(1);
  });

  it('isolates couple A media from couple B', async () => {
    const { service } = harness();
    await expect(service.list('couple-b', user)).rejects.toMatchObject({
      response: { code: 'WRONG_WEDDING' },
    });
  });

  it('prevents couple A from uploading or replacing through couple B', async () => {
    const { service } = harness();
    await expect(
      service.upload('couple-b', { slot: 1, label: 'Private' }, files.jpeg, user),
    ).rejects.toMatchObject({ response: { code: 'WRONG_WEDDING' } });
  });

  it.each(['download', 'update', 'remove'] as const)(
    'prevents couple A from using %s on couple B media',
    async (operation) => {
      const { service, rows } = harness();
      rows.push({
        id: 'media-b',
        coupleId: 'couple-b',
        slot: 1,
        label: 'Private',
        objectKey: 'private-key',
        mimeType: 'image/jpeg',
        sizeBytes: 4,
        width: null,
        height: null,
        createdAt: now,
        updatedAt: now,
      });
      const call =
        operation === 'download'
          ? service.download('couple-a', 'media-b', user)
          : operation === 'update'
            ? service.update('couple-a', 'media-b', { label: 'Stolen' }, user)
            : service.remove('couple-a', 'media-b', user);
      await expect(call).rejects.toMatchObject({
        response: { code: 'WEDDING_MEDIA_NOT_FOUND' },
      });
    },
  );

  it('does not touch InvitationArtifact or Guest while uploading', async () => {
    const { service, weddingMedia } = harness();
    await service.upload('couple-a', { slot: 1, label: 'Main' }, files.jpeg, user);
    expect(weddingMedia.create).toHaveBeenCalledTimes(1);
    // The deliberately narrow Prisma harness has no InvitationArtifact or Guest delegates:
    // an accidental dependency on either domain would make this operation fail.
  });
});
