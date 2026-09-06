import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import request = require('supertest');
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanTestDatabase, createTestApplication } from './test-application';

describe('Auth session (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApplication();
    prisma = app.get(PrismaService);
    await cleanTestDatabase(prisma);
    await prisma.user.create({
      data: {
        email: 'admin.e2e@maryme.test',
        passwordHash: await argon2.hash('AdminPassword123!'),
        role: UserRole.SUPER_ADMIN,
      },
    });
  });
  afterAll(() => app?.close());
  it('serves health through production URI versioning', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect(({ body }) => expect(body.data).toBeDefined());
  });
  it('restores a session through the parsed HttpOnly refresh cookie and /auth/me', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin.e2e@maryme.test', password: 'AdminPassword123!' })
      .expect(200);
    expect(login.body.accessToken).toBeDefined();
    const cookie = login.headers['set-cookie'];
    expect(cookie?.[0]).toContain('maryme_refresh=');
    expect(cookie?.[0]).toContain('HttpOnly');
    const refresh = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .expect(200);
    expect(refresh.body.accessToken).toBeDefined();
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refresh.body.accessToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.data.email).toBe('admin.e2e@maryme.test'));
  });
});
