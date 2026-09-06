import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { validateSuperAdminEnvironment } from '../config/env.validation';
import { ensureSuperAdmin } from '../modules/auth/admin-bootstrap.service';

async function main(): Promise<void> {
  const config = validateSuperAdminEnvironment(process.env);
  const prisma = new PrismaClient();

  try {
    await prisma.$connect();
    const { user, created } = await ensureSuperAdmin(prisma, config);
    console.log(created ? 'SUPER_ADMIN créé avec succès.' : 'SUPER_ADMIN synchronisé avec succès.');
    console.log(`Email : ${user.email}`);
    console.log(`Téléphone : ${user.phone}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Admin bootstrap failed');
  process.exitCode = 1;
});
