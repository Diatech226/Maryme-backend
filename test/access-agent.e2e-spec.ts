import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import request = require('supertest');
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanTestDatabase, createTestApplication } from './test-application';

describe('ACCESS_AGENT access control (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createTestApplication();
    prisma = app.get(PrismaService);
    await cleanTestDatabase(prisma);
    await prisma.user.create({
      data: {
        email: 'admin.access@maryme.test',
        phone: '+22671000001',
        passwordHash: await argon2.hash('AdminPassword123!'),
        role: UserRole.SUPER_ADMIN,
      },
    });
    adminToken = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'admin.access@maryme.test', password: 'AdminPassword123!' })
        .expect(200)
    ).body.accessToken;
  });

  afterAll(() => app?.close());

  it('covers context, CRUD, station, duplicate details, tenancy, RBAC and invalidation', async () => {
    const createCouple = async (suffix: string, phone: string) => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/couples')
        .set(auth(adminToken))
        .send({
          partner1: `Partner ${suffix} A`,
          partner2: `Partner ${suffix} B`,
          weddingDate: '2027-06-01T00:00:00.000Z',
          location: 'Ouagadougou',
          email: `contact-${suffix}@maryme.test`,
          phone,
          guestQuota: 10,
          accountEmail: `couple-${suffix}@maryme.test`,
          accountPhone: phone,
          accountPassword: 'abcdef',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/couples/${response.body.data.id}/authorize`)
        .set(auth(adminToken))
        .expect(201);
      return response.body.data.id as string;
    };
    const coupleA = await createCouple('a', '+22671000002');
    const coupleB = await createCouple('b', '+22671000003');

    await request(app.getHttpServer())
      .patch(`/api/v1/couples/${coupleA}`)
      .set(auth(adminToken))
      .send({
        accessOpensAt: '2027-06-02T00:00:00.000Z',
        accessClosesAt: '2027-06-01T00:00:00.000Z',
      })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('INVALID_ACCESS_WINDOW'));

    const guestA = (
      await request(app.getHttpServer())
        .post(`/api/v1/couples/${coupleA}/guests`)
        .set(auth(adminToken))
        .send({
          firstName: 'Awa',
          lastName: 'Ouedraogo',
          side: 'BRIDE',
          coupons: 2,
          category: 'VIP',
          tableNumber: 'VIP-1',
          assignedSeats: ['A1', 'A2'],
        })
        .expect(201)
    ).body.data;
    const guestB = (
      await request(app.getHttpServer())
        .post(`/api/v1/couples/${coupleB}/guests`)
        .set(auth(adminToken))
        .send({ firstName: 'B', lastName: 'Guest', side: 'GROOM', coupons: 1, category: 'FRIENDS' })
        .expect(201)
    ).body.data;
    const qrA = (
      await request(app.getHttpServer())
        .post(`/api/v1/guests/${guestA.id}/invitations`)
        .set(auth(adminToken))
        .send({})
        .expect(201)
    ).body.data.token;
    const qrB = (
      await request(app.getHttpServer())
        .post(`/api/v1/guests/${guestB.id}/invitations`)
        .set(auth(adminToken))
        .send({})
        .expect(201)
    ).body.data.token;

    const createdAgent = await request(app.getHttpServer())
      .post(`/api/v1/couples/${coupleA}/access-agents`)
      .set(auth(adminToken))
      .send({
        name: 'Agent Porte A',
        email: 'agent-a@maryme.test',
        phone: '+22671000004',
        password: 'abcdef',
      })
      .expect(201);
    const agentId = createdAgent.body.data.id;
    await request(app.getHttpServer())
      .get(`/api/v1/couples/${coupleA}/access-agents`)
      .set(auth(adminToken))
      .expect(200)
      .expect(({ body }) => {
        expect(body.data[0]).toMatchObject({
          id: agentId,
          name: 'Agent Porte A',
          isActive: true,
          coupleId: coupleA,
        });
        expect(body.data[0]).not.toHaveProperty('passwordHash');
      });
    await request(app.getHttpServer())
      .patch(`/api/v1/couples/${coupleA}/access-agents/${agentId}`)
      .set(auth(adminToken))
      .send({ name: 'Agent VIP', email: 'agent-vip@maryme.test', phone: '+22671000005' })
      .expect(200)
      .expect(({ body }) =>
        expect(body.data).toMatchObject({ name: 'Agent VIP', email: 'agent-vip@maryme.test' }),
      );

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'agent-vip@maryme.test', password: 'abcdef' })
      .expect(200);
    const agentToken = login.body.accessToken;
    const context = await request(app.getHttpServer())
      .get('/api/v1/access/context')
      .set(auth(agentToken))
      .expect(200);
    expect(context.body.data).toEqual({
      coupleId: coupleA,
      partner1: 'Partner a A',
      partner2: 'Partner a B',
      weddingDate: '2027-06-01T00:00:00.000Z',
      location: 'Ouagadougou',
      accessOpensAt: null,
      accessClosesAt: null,
      status: 'AUTHORIZED',
    });
    await request(app.getHttpServer())
      .get(`/api/v1/couples/${coupleA}`)
      .set(auth(agentToken))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/couples/${coupleA}/guests`)
      .set(auth(agentToken))
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/couples/${coupleA}/access-agents`)
      .set(auth(agentToken))
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/checkins/validate')
      .set(auth(agentToken))
      .send({ token: qrB })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('WRONG_WEDDING'));
    await request(app.getHttpServer())
      .get(`/api/v1/couples/${coupleB}/checkins`)
      .set(auth(agentToken))
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/checkins/validate')
      .set(auth(agentToken))
      .send({ token: qrA })
      .expect(201);

    const checkIn = await request(app.getHttpServer())
      .post('/api/v1/checkins')
      .set(auth(agentToken))
      .send({ token: qrA, deviceId: 'web-test-001', stationName: 'Porte VIP' })
      .expect(201);
    expect(checkIn.body.data).toMatchObject({
      guestId: guestA.id,
      coupleId: coupleA,
      deviceId: 'web-test-001',
      stationName: 'Porte VIP',
      operatorId: agentId,
      status: 'VALID',
    });
    expect(checkIn.body.data.guest).toMatchObject({
      id: guestA.id,
      coupons: 2,
      side: 'BRIDE',
      category: 'VIP',
    });
    expect(
      (await prisma.checkIn.findUniqueOrThrow({ where: { guestId: guestA.id } })).stationName,
    ).toBe('Porte VIP');
    await request(app.getHttpServer())
      .post('/api/v1/checkins/validate')
      .set(auth(agentToken))
      .send({ token: qrA })
      .expect(201)
      .expect(({ body }) =>
        expect(body.data).toMatchObject({
          alreadyCheckedIn: true,
          checkIn: {
            deviceId: 'web-test-001',
            stationName: 'Porte VIP',
            operatorName: 'Agent VIP',
          },
        }),
      );
    await request(app.getHttpServer())
      .get(`/api/v1/couples/${coupleA}/checkins`)
      .set(auth(agentToken))
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/couples/${coupleA}/access-agents/${agentId}/reset-password`)
      .set(auth(adminToken))
      .send({ password: 'ghijkl' })
      .expect(201);
    expect(
      await prisma.refreshSession.count({ where: { userId: agentId, revokedAt: { not: null } } }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.auditLog.count({
        where: { action: 'ACCESS_AGENT_PASSWORD_RESET', entityId: agentId },
      }),
    ).toBe(1);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'agent-vip@maryme.test', password: 'abcdef' })
      .expect(401);
    const newToken = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'agent-vip@maryme.test', password: 'ghijkl' })
        .expect(200)
    ).body.accessToken;
    await request(app.getHttpServer())
      .patch(`/api/v1/couples/${coupleA}/access-agents/${agentId}`)
      .set(auth(adminToken))
      .send({ isActive: false })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/access/context')
      .set(auth(newToken))
      .expect(401);
  });

  it('refuses an agent access token immediately after its couple is suspended', async () => {
    const agent = await prisma.user.findUniqueOrThrow({
      where: { email: 'agent-vip@maryme.test' },
    });
    await prisma.user.update({ where: { id: agent.id }, data: { isActive: true } });
    const token = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: agent.email, password: 'ghijkl' })
        .expect(200)
    ).body.accessToken;
    await request(app.getHttpServer())
      .post(`/api/v1/couples/${agent.coupleId}/suspend`)
      .set(auth(adminToken))
      .expect(201);
    await request(app.getHttpServer()).get('/api/v1/access/context').set(auth(token)).expect(401);
  });
});
