import { PrismaClient, User, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { normalizePhoneNumber } from '../../common/utils/phone';
import { SuperAdminEnvironment } from '../../config/env.validation';

export interface SuperAdminBootstrapResult {
  user: User;
  created: boolean;
}

/** Explicitly creates or synchronizes the one environment-managed SUPER_ADMIN. */
export async function ensureSuperAdmin(
  prisma: PrismaClient,
  config: SuperAdminEnvironment,
): Promise<SuperAdminBootstrapResult> {
  const email = config.SUPER_ADMIN_EMAIL.trim().toLowerCase();
  const phone = normalizePhoneNumber(config.SUPER_ADMIN_PHONE);
  const passwordHash = await argon2.hash(config.SUPER_ADMIN_PASSWORD);

  return prisma.$transaction(async (transaction) => {
    const emailUser = await transaction.user.findUnique({ where: { email } });
    if (emailUser && emailUser.role !== UserRole.SUPER_ADMIN) {
      throw new Error('SUPER_ADMIN_EMAIL is already assigned to a non-admin user');
    }

    const existing =
      emailUser ??
      (await transaction.user.findFirst({
        where: { role: UserRole.SUPER_ADMIN },
        orderBy: { createdAt: 'asc' },
      }));

    const phoneUser = await transaction.user.findUnique({ where: { phone } });
    if (phoneUser && phoneUser.id !== existing?.id) {
      throw new Error('SUPER_ADMIN_PHONE is already assigned to another user');
    }

    if (existing && existing.email !== email) {
      const owner = await transaction.user.findUnique({ where: { email } });
      if (owner && owner.id !== existing.id) {
        throw new Error('SUPER_ADMIN_EMAIL is already assigned to another user');
      }
    }

    const data = {
      email,
      phone,
      firstName: config.SUPER_ADMIN_FIRST_NAME.trim(),
      lastName: config.SUPER_ADMIN_LAST_NAME.trim(),
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
    };

    if (existing) {
      const now = new Date();
      const user = await transaction.user.update({ where: { id: existing.id }, data });
      await transaction.refreshSession.updateMany({
        where: { userId: existing.id, OR: [{ revokedAt: null }, { revokedAt: { isSet: false } }] },
        data: { revokedAt: now },
      });
      return { user, created: false };
    }

    return { user: await transaction.user.create({ data }), created: true };
  });
}
