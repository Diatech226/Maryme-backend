import { UserRole } from '@prisma/client';
export interface AuthUser { sub: string; role: UserRole; coupleId?: string }
