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
      findMany: jest.fn(async ({ where }) => rows.filter((row) => row.coupleId === where.coupleId)),
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
    const service = new WeddingMediaService(
      prisma as never,
      storage as never,
      { get: jest.fn().mockReturnValue(20) } as never,
      { record: jest.fn() } as never,
    );
    return { service, rows, storage, weddingMedia, objects };
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
    await expect(service.download('couple-a', first.id, user)).resolves.toMatchObject({
      body: files.png.buffer,
      contentType: 'image/png',
      sizeBytes: files.png.size,
    });
  });

  it('lists safe metadata without exposing objectKey', async () => {
    const { service } = harness();
    await service.upload('couple-a', { slot: 2, label: 'Programme' }, files.png, user);
    const result = await service.list('couple-a', user);
    expect(result[0]).not.toHaveProperty('objectKey');
    expect(result[0]).toMatchObject({ slot: 2, hasFile: true });
  });

  it('deletes both metadata and the GridFS object', async () => {
    const { service, rows, storage } = harness();
    const media = await service.upload('couple-a', { slot: 3, label: 'Info' }, files.webp, user);
    const key = rows[0].objectKey;
    await service.remove('couple-a', media.id, user);
    expect(rows).toHaveLength(0);
    expect(storage.delete).toHaveBeenCalledWith(key);
  });

  it('isolates couple A media from couple B', async () => {
    const { service } = harness();
    await expect(service.list('couple-b', user)).rejects.toMatchObject({
      response: { code: 'WRONG_WEDDING' },
    });
  });
});
