import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import * as argon2 from 'argon2';
import { PrismaService } from '../src/prisma/prisma.service';
import { InvitationStatus, UserRole } from '@prisma/client';
import { cleanTestDatabase, createTestApplication } from './test-application';
const coupleDto = (email: string, phone: string, password: string) => ({
  partner1: 'Alice',
  partner2: 'Bob',
  weddingDate: '2027-06-01T00:00:00.000Z',
  location: 'Ouagadougou',
  email: 'contact@maryme.test',
  phone: '+22670000000',
  guestQuota: 10,
  accountEmail: email,
  accountPhone: phone,
  accountPassword: password,
});
describe('Maryme lifecycle (e2e)', () => {
  let app: INestApplication, prisma: PrismaService, admin: string;
  beforeAll(async () => {
    app = await createTestApplication();
    prisma = app.get(PrismaService);
    await cleanTestDatabase(prisma);
    await prisma.user.create({
      data: {
        email: 'admin.flow@maryme.test',
        phone: '+22670000001',
        passwordHash: await argon2.hash('AdminPassword123!'),
        role: UserRole.SUPER_ADMIN,
      },
    });
    admin = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'admin.flow@maryme.test', password: 'AdminPassword123!' })
    ).body.accessToken;
  });
  afterAll(() => app?.close());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  it('create, authorize, invite, validate and protects duplicate/concurrent check-ins', async () => {
    const email = 'couple.flow@maryme.test',
      password = 'CouplePassword123!';
    const created = await request(app.getHttpServer())
      .post('/api/v1/couples')
      .set(auth(admin))
      .send({ ...coupleDto(email, '+22670000002', password), notes: 'Test' })
      .expect(201);
    const id = created.body.data.id;
    expect(created.body.data.status).toBe('PENDING');
    expect(created.body.data.notes).toBe('Test');
    expect(await prisma.user.findUnique({ where: { email } })).toMatchObject({
      phone: '+22670000002',
      coupleId: id,
    });
    await request(app.getHttpServer())
      .get(`/api/v1/couples/${id}`)
      .set(auth(admin))
      .expect(200)
      .expect(({ body }) => expect(body.data.notes).toBe('Test'));
    await request(app.getHttpServer())
      .post(`/api/v1/couples/${id}/authorize`)
      .set(auth(admin))
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const token = login.body.accessToken;
    const guest = (
      await request(app.getHttpServer())
        .post(`/api/v1/couples/${id}/guests`)
        .set(auth(token))
        .send({
          firstName: 'Lea',
          lastName: 'Martin',
          side: 'BRIDE',
          coupons: 1,
          category: 'FRIENDS',
        })
        .expect(201)
    ).body.data;
    const firstInvitation = (
      await request(app.getHttpServer())
        .post(`/api/v1/guests/${guest.id}/invitations`)
        .set(auth(token))
        .send({})
        .expect(201)
    ).body.data;
    const invitation = (
      await request(app.getHttpServer())
        .post(`/api/v1/guests/${guest.id}/invitations`)
        .set(auth(token))
        .send({})
        .expect(201)
    ).body.data;
    await request(app.getHttpServer())
      .post('/api/v1/checkins/validate')
      .set(auth(token))
      .send({ token: firstInvitation.token })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/checkins/validate')
      .set(auth(token))
      .send({ token: invitation.token })
      .expect(201);
    expect(
      await prisma.invitation.count({
        where: { guestId: guest.id, status: InvitationStatus.ACTIVE },
      }),
    ).toBe(1);
    const results = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/checkins')
        .set(auth(token))
        .send({ token: invitation.token }),
      request(app.getHttpServer())
        .post('/api/v1/checkins')
        .set(auth(token))
        .send({ token: invitation.token }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const checkedIn = await request(app.getHttpServer())
      .get(`/api/v1/couples/${id}/guests?checkedIn=true`)
      .set(auth(token))
      .expect(200);
    const notCheckedIn = await request(app.getHttpServer())
      .get(`/api/v1/couples/${id}/guests?checkedIn=false`)
      .set(auth(token))
      .expect(200);
    expect(checkedIn.body.data.map((item: { id: string }) => item.id)).toContain(guest.id);
    expect(notCheckedIn.body.data.map((item: { id: string }) => item.id)).not.toContain(guest.id);
    await request(app.getHttpServer())
      .post('/api/v1/checkins')
      .set(auth(token))
      .send({ token: invitation.token })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/couples/${id}/guests/bulk`)
      .set(auth(token))
      .send({ mode: 'replace', guests: [] })
      .expect(409);
  });
  it('supports append/replace/quota and enforces cross-couple RBAC', async () => {
    const a = (
      await request(app.getHttpServer())
        .post('/api/v1/couples')
        .set(auth(admin))
        .send(coupleDto('a@maryme.test', '+22670000003', 'CouplePassword123!'))
    ).body.data;
    const b = (
      await request(app.getHttpServer())
        .post('/api/v1/couples')
        .set(auth(admin))
        .send(coupleDto('b@maryme.test', '+22670000004', 'CouplePassword123!'))
    ).body.data;
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'b@maryme.test', password: 'CouplePassword123!' })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('COUPLE_PENDING'));
    await request(app.getHttpServer()).post(`/api/v1/couples/${a.id}/authorize`).set(auth(admin));
    const authorizedLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'a@maryme.test', password: 'CouplePassword123!' })
      .expect(200);
    const token = authorizedLogin.body.accessToken;
    const refreshCookie = authorizedLogin.headers['set-cookie'];
    const guest = {
      firstName: 'A',
      lastName: 'Guest',
      side: 'GROOM',
      coupons: 1,
      category: 'FRIENDS',
    };
    await request(app.getHttpServer())
      .post(`/api/v1/couples/${a.id}/guests/bulk`)
      .set(auth(token))
      .send({ mode: 'append', guests: [guest] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/couples/${a.id}/guests/bulk`)
      .set(auth(token))
      .send({ mode: 'replace', guests: [{ ...guest, firstName: 'Replacement' }] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/couples/${a.id}/guests/bulk`)
      .set(auth(token))
      .send({ mode: 'append', guests: [{ ...guest, coupons: 20 }] })
      .expect(409);
    await request(app.getHttpServer())
      .get(`/api/v1/couples/${b.id}/guests`)
      .set(auth(token))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/couples/${a.id}/suspend`)
      .set(auth(admin))
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'a@maryme.test', password: 'CouplePassword123!' })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('COUPLE_SUSPENDED'));
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('COUPLE_SUSPENDED'));

    await request(app.getHttpServer())
      .post(`/api/v1/couples/${a.id}/reset-password`)
      .set(auth(admin))
      .send({ password: 'NewCouplePassword123!' })
      .expect(201);
    const account = await prisma.user.findUniqueOrThrow({ where: { email: 'a@maryme.test' } });
    expect(await argon2.verify(account.passwordHash, 'NewCouplePassword123!')).toBe(true);
    expect(
      await prisma.refreshSession.count({ where: { userId: account.id, revokedAt: { not: null } } }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.auditLog.count({
        where: { action: 'COUPLE_PASSWORD_RESET', entityId: account.id },
      }),
    ).toBe(1);

    await request(app.getHttpServer()).post(`/api/v1/couples/${a.id}/authorize`).set(auth(admin));
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'a@maryme.test', password: 'CouplePassword123!' })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('INVALID_CREDENTIALS'));
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'a@maryme.test', password: 'NewCouplePassword123!' })
      .expect(200)
      .expect(({ body }) => expect(body.accessToken).toBeDefined());
  });
});
