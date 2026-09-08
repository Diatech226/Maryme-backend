import { ConfigService } from '@nestjs/config';
import { MongoClient } from 'mongodb';
import { StorageService } from './storage.service';

const uri = process.env.TEST_DATABASE_URL;
const integration = uri ? describe : describe.skip;

integration('StorageService MongoDB GridFS integration', () => {
  const bucket = 'maryme_test_storage';
  const key = `integration/${Date.now()}/artifact`;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const config = new ConfigService({
    NODE_ENV: 'test',
    DATABASE_URL: uri,
    STORAGE_DRIVER: 'gridfs',
    GRIDFS_BUCKET: bucket,
  });

  afterAll(async () => {
    const client = new MongoClient(uri!);
    await client.connect();
    await client
      .db()
      .collection(`${bucket}.files`)
      .drop()
      .catch(() => undefined);
    await client
      .db()
      .collection(`${bucket}.chunks`)
      .drop()
      .catch(() => undefined);
    await client.close();
  });

  it('persists PUT/GET across service instances and DELETE removes files and chunks', async () => {
    const first = new StorageService(config);
    await first.onModuleInit();
    await first.put(key, png, 'image/png');
    await first.onApplicationShutdown();

    const second = new StorageService(config);
    await second.onModuleInit();
    await expect(second.get(key)).resolves.toEqual({ body: png, contentType: 'image/png' });
    await second.delete(key);
    await expect(second.get(key)).rejects.toMatchObject({
      response: { code: 'STORAGE_OBJECT_NOT_FOUND' },
    });
    await second.onApplicationShutdown();
  });

  it.each([
    ['image/png', png],
    ['application/pdf', Buffer.from('%PDF-1.7 artifact')],
  ])('preserves %s artifact bytes and content type', async (contentType, body) => {
    const storage = new StorageService(config);
    await storage.onModuleInit();
    const artifactKey = `${key}-${contentType.replace('/', '-')}`;
    await storage.put(artifactKey, body, contentType);
    await expect(storage.get(artifactKey)).resolves.toEqual({ body, contentType });
    await storage.delete(artifactKey);
    await storage.onApplicationShutdown();
  });
});
