import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const storageStatus = {
    backend: 'mongodb-gridfs',
    persistent: true,
    connected: true,
    bucket: 'maryme_storage',
    warning: null,
  };

  function setup() {
    const prisma = { $runCommandRaw: jest.fn().mockResolvedValue({ ok: 1 }) };
    const storage = { status: jest.fn().mockResolvedValue(storageStatus) };
    return {
      prisma,
      storage,
      controller: new HealthController(prisma as never, storage as never),
    };
  }

  it('reports healthy only when Prisma and GridFS are connected', async () => {
    const { controller } = setup();
    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      database: 'connected',
      storage: storageStatus,
    });
  });

  it('returns a structured 503 when GridFS is disconnected', async () => {
    const { controller, storage } = setup();
    storage.status.mockResolvedValue({
      ...storageStatus,
      connected: false,
      warning: 'MongoDB GridFS storage is unavailable.',
    });
    await expect(controller.check()).rejects.toMatchObject({
      status: 503,
      response: {
        status: 'degraded',
        database: 'connected',
        storage: expect.objectContaining({ connected: false }),
      },
    });
  });

  it('returns 503 without querying or exposing storage details when Prisma is unavailable', async () => {
    const { controller, prisma, storage } = setup();
    prisma.$runCommandRaw.mockRejectedValue(new Error('mongodb://user:secret@example'));
    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(controller.check()).rejects.toMatchObject({
      status: 503,
      response: { status: 'degraded', database: 'disconnected' },
    });
    expect(storage.status).not.toHaveBeenCalled();
  });
});
