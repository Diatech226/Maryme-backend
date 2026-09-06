import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CoupleStatus, Prisma, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthUser } from '../../common/types/auth-user';
import { assertCoupleAccess } from '../../common/utils/ownership';
import { normalizePhoneNumber } from '../../common/utils/phone';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CoupleQueryDto,
  CreateCoupleDto,
  ResetCouplePasswordDto,
  UpdateCoupleAccountDto,
  UpdateCoupleDto,
} from './dto/couple.dto';

@Injectable()
export class CouplesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  async list(q: CoupleQueryDto) {
    const where: Prisma.CoupleWhereInput = {
      AND: [{ OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] }],
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { partner1: { contains: q.search, mode: 'insensitive' } },
              { partner2: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.couple.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.couple.count({ where }),
    ]);
    return {
      data,
      meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
    };
  }
  private duplicateAccountError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = String(error.meta?.target ?? '');
      if (target.includes('phone')) {
        throw new ConflictException('Ce numéro de téléphone est déjà associé à un compte.');
      }
      throw new ConflictException('Cet email est déjà associé à un compte.');
    }
    throw error;
  }

  async create(dto: CreateCoupleDto, actor: AuthUser) {
    const { accountEmail, accountPhone, accountPassword, ...couple } = dto;
    if (Boolean(accountEmail) !== Boolean(accountPassword)) {
      throw new BadRequestException('accountEmail and accountPassword must be provided together');
    }
    if (accountPhone && !accountEmail) {
      throw new BadRequestException('accountPhone requires accountEmail and accountPassword');
    }
    const email = accountEmail?.trim().toLowerCase();
    let phone: string | undefined;
    try {
      phone = accountPhone ? normalizePhoneNumber(accountPhone) : undefined;
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const passwordHash = accountPassword ? await argon2.hash(accountPassword) : undefined;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const created = await tx.couple.create({ data: couple });
        if (email && passwordHash) {
          await tx.user.create({
            data: {
              email,
              phone,
              passwordHash,
              role: UserRole.COUPLE,
              coupleId: created.id,
            },
          });
        }
        return created;
      });
      void this.audit.record({
        userId: actor.sub,
        action: 'COUPLE_CREATED',
        entityType: 'Couple',
        entityId: result.id,
      });
      return result;
    } catch (error) {
      this.duplicateAccountError(error);
    }
  }

  async resetPassword(id: string, dto: ResetCouplePasswordDto, actor: AuthUser) {
    await this.get(id, actor);
    const account = await this.prisma.user.findFirst({ where: { coupleId: id } });
    if (!account) throw new NotFoundException('Compte utilisateur du couple introuvable.');
    const passwordHash = await argon2.hash(dto.password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: account.id }, data: { passwordHash } }),
      this.prisma.refreshSession.updateMany({
        where: { userId: account.id, OR: [{ revokedAt: null }, { revokedAt: { isSet: false } }] },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: actor.sub,
          action: 'COUPLE_PASSWORD_RESET',
          entityType: 'User',
          entityId: account.id,
          metadata: { coupleId: id },
        },
      }),
    ]);
    return { id: account.id, email: account.email, phone: account.phone, coupleId: id };
  }

  async updateAccount(id: string, dto: UpdateCoupleAccountDto, actor: AuthUser) {
    await this.get(id, actor);
    if (dto.email === undefined && dto.phone === undefined) {
      throw new BadRequestException('Au moins un email ou un téléphone doit être fourni.');
    }
    const account = await this.prisma.user.findFirst({ where: { coupleId: id } });
    if (!account) throw new NotFoundException('Compte utilisateur du couple introuvable.');
    let phone: string | undefined;
    try {
      phone = dto.phone === undefined ? undefined : normalizePhoneNumber(dto.phone);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    try {
      const updated = await this.prisma.user.update({
        where: { id: account.id },
        data: {
          ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() } : {}),
          ...(phone !== undefined ? { phone } : {}),
        },
      });
      void this.audit.record({
        userId: actor.sub,
        action: 'COUPLE_ACCOUNT_UPDATED',
        entityType: 'User',
        entityId: updated.id,
        metadata: { coupleId: id },
      });
      return {
        id: updated.id,
        email: updated.email,
        phone: updated.phone,
        role: updated.role,
        coupleId: updated.coupleId,
        firstName: updated.firstName,
        lastName: updated.lastName,
      };
    } catch (error) {
      this.duplicateAccountError(error);
    }
  }

  async get(id: string, user: AuthUser) {
    assertCoupleAccess(user, id);
    const couple = await this.prisma.couple.findFirst({
      where: { id, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
    });
    if (!couple) throw new NotFoundException('Couple not found');
    return couple;
  }
  async update(id: string, dto: UpdateCoupleDto, user: AuthUser) {
    await this.get(id, user);
    const { guestQuota, ...selfData } = dto;
    const data = user.role === UserRole.SUPER_ADMIN ? dto : selfData;
    const result = await this.prisma.couple.update({ where: { id }, data });
    void this.audit.record({
      userId: user.sub,
      action: 'COUPLE_UPDATED',
      entityType: 'Couple',
      entityId: id,
    });
    return result;
  }
  async status(id: string, status: CoupleStatus, user: AuthUser) {
    await this.get(id, user);
    const result = await this.prisma.couple.update({
      where: { id },
      data: { status, authorizedAt: status === CoupleStatus.AUTHORIZED ? new Date() : null },
    });
    void this.audit.record({
      userId: user.sub,
      action: status === CoupleStatus.AUTHORIZED ? 'COUPLE_AUTHORIZED' : 'COUPLE_SUSPENDED',
      entityType: 'Couple',
      entityId: id,
    });
    return result;
  }
  async remove(id: string, user: AuthUser): Promise<void> {
    await this.get(id, user);
    await this.prisma.$transaction([
      this.prisma.user.updateMany({ where: { coupleId: id }, data: { isActive: false } }),
      this.prisma.couple.update({
        where: { id },
        data: { deletedAt: new Date(), status: CoupleStatus.SUSPENDED },
      }),
    ]);
    void this.audit.record({
      userId: user.sub,
      action: 'COUPLE_DELETED',
      entityType: 'Couple',
      entityId: id,
    });
  }
}
