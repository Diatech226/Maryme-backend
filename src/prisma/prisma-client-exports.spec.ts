import {
  CoupleStatus,
  DietaryRequirement,
  GuestCategory,
  GuestSide,
  InvitationStatus,
  Prisma,
  PrismaClient,
  RsvpStatus,
  UserRole,
} from '@prisma/client';
import type { User } from '@prisma/client';

type GeneratedInputTypes = [
  Prisma.CheckInWhereInput,
  Prisma.GuestWhereInput,
  Prisma.AuditLogUncheckedCreateInput,
  User,
];

describe('generated Prisma Client exports', () => {
  it('exposes the schema enums, models, inputs, and client', () => {
    const generatedTypesCompile: GeneratedInputTypes | undefined = undefined;

    expect(generatedTypesCompile).toBeUndefined();
    expect(UserRole.SUPER_ADMIN).toBe('SUPER_ADMIN');
    expect(CoupleStatus.AUTHORIZED).toBe('AUTHORIZED');
    expect(InvitationStatus.ACTIVE).toBe('ACTIVE');
    expect(GuestCategory.VIP).toBe('VIP');
    expect(GuestSide.BRIDE).toBe('BRIDE');
    expect(RsvpStatus.CONFIRMED).toBe('CONFIRMED');
    expect(DietaryRequirement.HALAL).toBe('HALAL');
    expect(Prisma.dmmf.datamodel.models.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['User', 'Couple', 'Guest', 'Coupon', 'Invitation', 'CheckIn', 'AuditLog']),
    );
    expect(PrismaClient).toBeDefined();
  });
});
