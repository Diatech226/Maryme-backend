import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap/configure-application';
import { PrismaService } from '../src/prisma/prisma.service';

export async function createTestApplication(): Promise<INestApplication> {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = module.createNestApplication();
  configureApplication(app);
  await app.init();
  return app;
}

export async function cleanTestDatabase(prisma: PrismaService): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  let database = '';
  try {
    database = new URL(url).pathname.slice(1);
  } catch {
    /* rejected below */
  }
  if (process.env.NODE_ENV !== 'test' || !database.toLowerCase().includes('test')) {
    throw new Error(
      'Refusing to purge a database unless NODE_ENV=test and its name contains "test"',
    );
  }
  await prisma.checkIn.deleteMany();
  await prisma.invitationShareLink.deleteMany();
  await prisma.invitationArtifact.deleteMany();
  await prisma.invitationDesign.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.coupon.deleteMany();
  await prisma.guest.deleteMany();
  await prisma.refreshSession.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.couple.deleteMany();
}
