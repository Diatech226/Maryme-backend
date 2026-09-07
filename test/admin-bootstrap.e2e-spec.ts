import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { ensureSuperAdmin } from '../src/modules/auth/admin-bootstrap.service';
import { SuperAdminEnvironment } from '../src/config/env.validation';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanTestDatabase, createTestApplication } from './test-application';

describe('SUPER_ADMIN bootstrap (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const base: SuperAdminEnvironment = {
    SUPER_ADMIN_EMAIL: ' Admin.Bootstrap@Maryme.Test ',
    SUPER_ADMIN_PHONE: '+226 70-00-00-01',
    SUPER_ADMIN_PASSWORD: 'AdminBootstrapPassword123!',
    SUPER_ADMIN_FIRST_NAME: 'Admin',
    SUPER_ADMIN_LAST_NAME: 'Test',
  };

  beforeAll(async () => {
    app = await createTestApplication();
    prisma = app.get(PrismaService);
  });
  beforeEach(() => cleanTestDatabase(prisma));
  afterAll(() => app?.close());

  it('creates a normalized account with only an Argon2 password hash', async () => {
    const { user, created } = await ensureSuperAdmin(prisma, base);
    expect(created).toBe(true);
    expect(user).toMatchObject({
      email: 'admin.bootstrap@maryme.test',
      phone: '+22670000001',
      firstName: 'Admin',
      lastName: 'Test',
      role: UserRole.SUPER_ADMIN,
      isActive: true,
    });
    expect(user.passwordHash).not.toBe(base.SUPER_ADMIN_PASSWORD);
    expect(await argon2.verify(user.passwordHash, base.SUPER_ADMIN_PASSWORD)).toBe(true);
  });

  it('is idempotent, rotates credentials and revokes active refresh sessions', async () => {
    const first = await ensureSuperAdmin(prisma, base);
    const session = await prisma.refreshSession.create({
      data: {
        userId: first.user.id,
        tokenHash: 'bootstrap-session-token-hash',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const changed = {
      ...base,
      SUPER_ADMIN_PHONE: '+22670000002',
      SUPER_ADMIN_PASSWORD: 'AdminBootstrapPassword456!',
    };
    const second = await ensureSuperAdmin(prisma, changed);

    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    expect(second.user.phone).toBe('+22670000002');
    expect(await prisma.user.count({ where: { role: UserRole.SUPER_ADMIN } })).toBe(1);
    expect(await argon2.verify(second.user.passwordHash, base.SUPER_ADMIN_PASSWORD)).toBe(false);
    expect(await argon2.verify(second.user.passwordHash, changed.SUPER_ADMIN_PASSWORD)).toBe(true);

    const rotatedSession = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(rotatedSession.revokedAt).toBeInstanceOf(Date);
  });

  it('refuses a phone owned by someone else without changing the admin', async () => {
    const original = await ensureSuperAdmin(prisma, base);
    await prisma.user.create({
      data: {
        email: 'other@maryme.test',
        phone: '+22670000003',
        passwordHash: await argon2.hash('OtherUserPassword123!'),
        role: UserRole.COUPLE,
      },
    });
    await expect(
      ensureSuperAdmin(prisma, { ...base, SUPER_ADMIN_PHONE: '+22670000003' }),
    ).rejects.toThrow('already assigned');
    expect(await prisma.user.findUniqueOrThrow({ where: { id: original.user.id } })).toMatchObject({
      phone: '+22670000001',
    });
  });
});
