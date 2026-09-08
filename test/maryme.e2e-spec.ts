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
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/checkins/validate')
      .set(auth(token))
      .send({ token: invitation.token })
      .expect(201);
    expect(
      await prisma.invitation.count({
        where: { guestId: guest.id, status: InvitationStatus.ACTIVE },
      }),
    ).toBe(2);
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
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('GUEST_ALREADY_CHECKED_IN'));
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
      await prisma.refreshSession.count({
        where: { userId: account.id, revokedAt: { not: null } },
      }),
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
  it('persists private designs, image/PDF artifacts, stale state and revocable shares', async () => {
    const email = 'cards@maryme.test';
    const couple = (
      await request(app.getHttpServer())
        .post('/api/v1/couples')
        .set(auth(admin))
        .send(coupleDto(email, '+22670000005', 'CouplePassword123!'))
        .expect(201)
    ).body.data;
    await request(app.getHttpServer())
      .post(`/api/v1/couples/${couple.id}/authorize`)
      .set(auth(admin))
      .expect(201);
    const token = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'CouplePassword123!' })
        .expect(200)
    ).body.accessToken;
    await request(app.getHttpServer())
      .patch(`/api/v1/couples/${couple.id}`)
      .set(auth(token))
      .send({ invitationIntroText: 'Bienvenue', invitationFooterText: 'À bientôt' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/couples/${couple.id}`)
      .set(auth(token))
      .send({ id: couple.id })
      .expect(400);

    const overlay = { qr: { enabled: true, x: 0.1, y: 0.1 } };
    await request(app.getHttpServer())
      .post(`/api/v1/couples/${couple.id}/invitation-designs`)
      .set(auth(token))
      .send({ mode: 'GENERATED', templateKey: 'classic', overlayConfig: overlay })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/couples/${couple.id}/invitation-designs`)
      .set(auth(token))
      .send({
        name: 'Invalid',
        mode: 'GENERATED',
        templateKey: 'classic',
        overlayConfig: { qr: { enabled: true, x: 4, y: 0.1, unknown: true } },
      })
      .expect(400);
    const generated = (
      await request(app.getHttpServer())
        .post(`/api/v1/couples/${couple.id}/invitation-designs`)
        .set(auth(token))
        .send({ name: 'Maryme', mode: 'GENERATED', templateKey: 'classic', overlayConfig: overlay })
        .expect(201)
    ).body.data;
    await request(app.getHttpServer())
      .get(`/api/v1/couples/${couple.id}/invitation-designs`)
      .set(auth(token))
      .expect(200)
      .expect(({ body }) => expect(body.data[0].backgroundObjectKey).toBeUndefined());
    await request(app.getHttpServer())
      .patch(`/api/v1/couples/${couple.id}/invitation-designs/${generated.id}`)
      .set(auth(token))
      .send({ name: 'Maryme updated' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/couples/${couple.id}/invitation-designs/${generated.id}/activate`)
      .set(auth(token))
      .expect(201);
    const uploaded = (
      await request(app.getHttpServer())
        .post(`/api/v1/couples/${couple.id}/invitation-designs`)
        .set(auth(token))
        .send({ name: 'Upload', mode: 'UPLOADED', overlayConfig: {}, contentConfig: {} })
        .expect(201)
    ).body.data;
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    const pdf = Buffer.from('%PDF-1.4\n%%EOF');
    await request(app.getHttpServer())
      .post(`/api/v1/couples/${couple.id}/invitation-designs/${uploaded.id}/background`)
      .set(auth(token))
      .attach('file', png, { filename: 'card.png', contentType: 'image/png' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/couples/${couple.id}/invitation-designs/${uploaded.id}/background`)
      .set(auth(token))
      .expect('Content-Type', /image\/png/)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/couples/${couple.id}/invitation-designs/${uploaded.id}/background`)
      .set(auth(token))
      .attach('file', pdf, { filename: 'card.pdf', contentType: 'application/pdf' })
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/v1/couples/${couple.id}/invitation-designs/${uploaded.id}/background`)
      .set(auth(token))
      .expect('Content-Type', /image\/png/)
      .expect('Cache-Control', 'private, no-store')
      .expect('X-Content-Type-Options', 'nosniff')
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/couples/${couple.id}/invitation-designs/${uploaded.id}`)
      .set(auth(token))
      .send({ mode: 'GENERATED', templateKey: 'classic' })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('INVITATION_DESIGN_WRONG_MODE'));

    const guest = (
      await request(app.getHttpServer())
        .post(`/api/v1/couples/${couple.id}/guests`)
        .set(auth(token))
        .send({ firstName: 'Card', lastName: 'Guest', side: 'GROOM', coupons: 1, category: 'VIP' })
        .expect(201)
    ).body.data;
    const invitation = (
      await request(app.getHttpServer())
        .post(`/api/v1/guests/${guest.id}/invitations`)
        .set(auth(token))
        .send({})
        .expect(201)
    ).body.data;
    const artifact = (
      await request(app.getHttpServer())
        .post(`/api/v1/invitations/${invitation.id}/artifact`)
        .set(auth(token))
        .field('designId', uploaded.id)
        .attach('image', png, { filename: 'invitation.png', contentType: 'image/png' })
        .attach('pdf', pdf, { filename: 'invitation.pdf', contentType: 'application/pdf' })
        .expect(201)
    ).body.data;
    expect(artifact).toMatchObject({
      guestId: guest.id,
      hasImage: true,
      hasPdf: true,
      stale: false,
    });
    expect(artifact.imageObjectKey).toBeUndefined();
    await request(app.getHttpServer())
      .get(`/api/v1/guests/${guest.id}/invitation-artifacts`)
      .set(auth(token))
      .expect(200)
      .expect(({ body }) => expect(body.data[0].stale).toBe(false));
    await request(app.getHttpServer())
      .get(`/api/v1/couples/${couple.id}/invitation-artifacts`)
      .set(auth(token))
      .expect(200)
      .expect(({ body }) => expect(body.data.data[0].id).toBe(artifact.id));
    for (let index = 0; index < 2; index++) {
      await request(app.getHttpServer())
        .post(`/api/v1/invitations/${invitation.id}/artifact`)
        .set(auth(token))
        .field('designId', uploaded.id)
        .attach('image', png, { filename: `invitation-${index}.png`, contentType: 'image/png' })
        .expect(201);
    }
    await request(app.getHttpServer())
      .get(
        `/api/v1/couples/${couple.id}/invitation-artifacts?page=2&limit=2&guestId=${guest.id}&stale=false`,
      )
      .set(auth(token))
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.data).toHaveLength(1);
        expect(body.data.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
      });
    await request(app.getHttpServer())
      .get(`/api/v1/invitation-artifacts/${artifact.id}/download?format=image`)
      .set(auth(token))
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/invitation-artifacts/${artifact.id}/download?format=pdf`)
      .set(auth(token))
      .expect('Content-Type', /application\/pdf/)
      .expect(200);
    const changedGuest = await prisma.guest.update({
      where: { id: guest.id },
      data: { notes: 'Guest changed' },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/guests/${guest.id}/invitation-artifacts`)
      .set(auth(token))
      .expect(200)
      .expect(({ body }) => expect(body.data[0].stale).toBe(true));
    const currentDesign = await prisma.invitationDesign.findUniqueOrThrow({
      where: { id: uploaded.id },
    });
    const currentCouple = await prisma.couple.findUniqueOrThrow({ where: { id: couple.id } });
    await prisma.invitationArtifact.update({
      where: { id: artifact.id },
      data: {
        guestUpdatedAt: changedGuest.updatedAt,
        designUpdatedAt: currentDesign.updatedAt,
        coupleUpdatedAt: currentCouple.updatedAt,
      },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/couples/${couple.id}/invitation-designs/${uploaded.id}`)
      .set(auth(token))
      .send({ name: 'Upload updated' })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/guests/${guest.id}/invitation-artifacts`)
      .set(auth(token))
      .expect(200)
      .expect(({ body }) => expect(body.data[0].stale).toBe(true));
    const changedDesign = await prisma.invitationDesign.findUniqueOrThrow({
      where: { id: uploaded.id },
    });
    await prisma.invitationArtifact.update({
      where: { id: artifact.id },
      data: { designUpdatedAt: changedDesign.updatedAt },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/couples/${couple.id}`)
      .set(auth(token))
      .send({ dressCode: 'Chic' })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/guests/${guest.id}/invitation-artifacts`)
      .set(auth(token))
      .expect(200)
      .expect(({ body }) => expect(body.data[0].stale).toBe(true));

    const share = (
      await request(app.getHttpServer())
        .post(`/api/v1/invitation-artifacts/${artifact.id}/share-link`)
        .set(auth(token))
        .send({})
        .expect(201)
    ).body.data;
    expect(share.id).toBeDefined();
    const shareToken = share.shareUrl.split('/').pop();
    const secondShare = (
      await request(app.getHttpServer())
        .post(`/api/v1/invitation-artifacts/${artifact.id}/share-link`)
        .set(auth(token))
        .send({})
        .expect(201)
    ).body.data;
    expect(secondShare.id).not.toBe(share.id);
    await request(app.getHttpServer())
      .get(`/api/v1/invitation-artifacts/${artifact.id}/share-links`)
      .set(auth(token))
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.map((link: { id: string }) => link.id)).toEqual(
          expect.arrayContaining([share.id, secondShare.id]),
        );
        expect(body.data[0].tokenHash).toBeUndefined();
        expect(body.data[0].shareUrl).toBeUndefined();
      });
    await request(app.getHttpServer())
      .get(`/api/v1/public/invitations/share/${shareToken}`)
      .expect('Cache-Control', 'private, no-store')
      .expect('X-Content-Type-Options', 'nosniff')
      .expect('Content-Type', /image\/png/)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/public/invitations/share/unknown-token')
      .expect(404);
    const qrBefore = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    await request(app.getHttpServer())
      .post(`/api/v1/invitation-share-links/${share.id}/revoke`)
      .set(auth(token))
      .expect(201)
      .expect(({ body }) =>
        expect(body.data).toEqual({ id: share.id, revokedAt: expect.any(String) }),
      );
    const qrAfter = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(qrAfter.tokenHash).toBe(qrBefore.tokenHash);
    expect(qrAfter.status).toBe('ACTIVE');
    await request(app.getHttpServer())
      .get(`/api/v1/public/invitations/share/${shareToken}`)
      .expect(410);
    await request(app.getHttpServer())
      .get(`/api/v1/public/invitations/share/${secondShare.shareUrl.split('/').pop()}`)
      .expect(200);

    const foreignEmail = 'foreign-cards@maryme.test';
    const foreign = (
      await request(app.getHttpServer())
        .post('/api/v1/couples')
        .set(auth(admin))
        .send(coupleDto(foreignEmail, '+22670000006', 'CouplePassword123!'))
        .expect(201)
    ).body.data;
    await request(app.getHttpServer())
      .post(`/api/v1/couples/${foreign.id}/authorize`)
      .set(auth(admin))
      .expect(201);
    const foreignToken = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: foreignEmail, password: 'CouplePassword123!' })
        .expect(200)
    ).body.accessToken;
    const forbidden = [
      request(app.getHttpServer())
        .get(`/api/v1/couples/${couple.id}/invitation-designs/${uploaded.id}`)
        .set(auth(foreignToken)),
      request(app.getHttpServer())
        .get(`/api/v1/couples/${couple.id}/invitation-designs/${uploaded.id}/background`)
        .set(auth(foreignToken)),
      request(app.getHttpServer())
        .get(`/api/v1/couples/${couple.id}/invitation-artifacts`)
        .set(auth(foreignToken)),
      request(app.getHttpServer())
        .get(`/api/v1/invitation-artifacts/${artifact.id}/download?format=image`)
        .set(auth(foreignToken)),
      request(app.getHttpServer())
        .post(`/api/v1/invitation-artifacts/${artifact.id}/share-link`)
        .set(auth(foreignToken)),
      request(app.getHttpServer())
        .get(`/api/v1/invitation-artifacts/${artifact.id}/share-links`)
        .set(auth(foreignToken)),
      request(app.getHttpServer())
        .post(`/api/v1/invitation-share-links/${secondShare.id}/revoke`)
        .set(auth(foreignToken)),
    ];
    for (const call of forbidden) await call.expect(403);
  });
});
