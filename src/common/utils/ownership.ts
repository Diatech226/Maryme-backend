import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../types/auth-user';
export function assertCoupleAccess(user: AuthUser, coupleId: string): void { if (user.role !== UserRole.SUPER_ADMIN && user.coupleId !== coupleId) throw new ForbiddenException('Access to another couple is forbidden'); }
