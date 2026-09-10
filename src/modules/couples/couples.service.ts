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
import { CouponPoolService } from '../coupons/coupon-pool.service';
import { ensureStandardWeddingTables } from '../tables/standard-wedding-tables';
import {
  CoupleQueryDto,
  CreateCoupleDto,
  ResetCouplePasswordDto,
  UpdateCoupleAccountDto,
  UpdateCoupleDto,
} from './dto/couple.dto';
import {
  CreateAccessAgentDto,
  ResetAccessAgentPasswordDto,
  UpdateAccessAgentDto,
} from './dto/access-agent.dto';

@Injectable()
export class CouplesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly coupons: CouponPoolService,
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
        throw new ConflictException({
          code: 'ACCOUNT_PHONE_ALREADY_EXISTS',
          message: 'Ce numéro de téléphone est déjà associé à un compte.',
        });
      }
      throw new ConflictException({
        code: 'ACCOUNT_EMAIL_ALREADY_EXISTS',
        message: 'Cet email est déjà associé à un compte.',
      });
    }
    throw error;
  }

  async create(dto: CreateCoupleDto, actor: AuthUser) {
    const { accountEmail, accountPhone, accountPassword, ...couple } = dto;
    if (!accountEmail || !accountPhone || !accountPassword) {
      throw new BadRequestException(
        'Email, téléphone et mot de passe du compte sont obligatoires.',
      );
    }
    const email = accountEmail.trim().toLowerCase();
    let phone: string;
    try {
      phone = normalizePhoneNumber(accountPhone);
    } catch (error) {
      throw new BadRequestException({
        code: 'INVALID_PHONE_NUMBER',
        message: (error as Error).message,
      });
    }
    const passwordHash = await argon2.hash(accountPassword);
    if (
      couple.accessOpensAt &&
      couple.accessClosesAt &&
      couple.accessClosesAt <= couple.accessOpensAt
    )
      throw new BadRequestException({
        code: 'INVALID_ACCESS_WINDOW',
        message: "La fermeture du contrôle d'accès doit suivre son ouverture.",
      });
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const created = await tx.couple.create({ data: couple });
        await tx.user.create({
          data: { email, phone, passwordHash, role: UserRole.COUPLE, coupleId: created.id },
        });
        await this.coupons.ensurePool(created.id, created.guestQuota, tx);
        await ensureStandardWeddingTables(created.id, tx);
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
      throw new BadRequestException({
        code: 'INVALID_PHONE_NUMBER',
        message: (error as Error).message,
      });
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
    const current = await this.get(id, user);
    const accessOpensAt = dto.accessOpensAt ?? current.accessOpensAt;
    const accessClosesAt = dto.accessClosesAt ?? current.accessClosesAt;
    if (accessOpensAt && accessClosesAt && accessClosesAt <= accessOpensAt) {
      throw new BadRequestException({
        code: 'INVALID_ACCESS_WINDOW',
        message: "La fermeture du contrôle d'accès doit suivre son ouverture.",
      });
    }
    const { guestQuota, ...selfData } = dto;
    const data = user.role === UserRole.SUPER_ADMIN ? dto : selfData;
    const result = await this.prisma.$transaction(async (tx) => {
      if (user.role === UserRole.SUPER_ADMIN && guestQuota !== undefined)
        await this.coupons.resize(id, current.guestQuota, guestQuota, tx);
      return tx.couple.update({ where: { id }, data });
    });
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

  async createAccessAgent(id: string, dto: CreateAccessAgentDto, actor: AuthUser) {
    await this.get(id, actor);
    let phone: string;
    try {
      phone = normalizePhoneNumber(dto.phone);
    } catch (error) {
      throw new BadRequestException({
        code: 'INVALID_PHONE_NUMBER',
        message: (error as Error).message,
      });
    }
    const parts = dto.name.trim().split(/\s+/);
    try {
      const agent = await this.prisma.user.create({
        data: {
          email: dto.email.trim().toLowerCase(),
          phone,
          passwordHash: await argon2.hash(dto.password),
          role: UserRole.ACCESS_AGENT,
          coupleId: id,
          firstName: parts.shift() || dto.name.trim(),
          lastName: parts.join(' ') || null,
        },
      });
      void this.audit.record({
        userId: actor.sub,
        action: 'ACCESS_AGENT_CREATED',
        entityType: 'User',
        entityId: agent.id,
        metadata: { coupleId: id },
      });
      return {
        id: agent.id,
        name: [agent.firstName, agent.lastName].filter(Boolean).join(' '),
        email: agent.email,
        phone: agent.phone,
        role: agent.role,
        coupleId: agent.coupleId,
        firstName: agent.firstName,
        lastName: agent.lastName,
        isActive: agent.isActive,
      };
    } catch (error) {
      this.duplicateAccountError(error);
    }
  }

  async accessContext(user: AuthUser) {
    if (!user.coupleId) throw new NotFoundException('Mariage introuvable.');
    const couple = await this.prisma.couple.findFirst({
      where: {
        id: user.coupleId,
        OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }],
      },
      select: {
        id: true,
        partner1: true,
        partner2: true,
        weddingDate: true,
        location: true,
        accessOpensAt: true,
        accessClosesAt: true,
        status: true,
      },
    });
    if (!couple) throw new NotFoundException('Mariage introuvable.');
    const { id, ...context } = couple;
    return { coupleId: id, ...context };
  }

  async listAccessAgents(id: string, actor: AuthUser) {
    await this.get(id, actor);
    const agents = await this.prisma.user.findMany({
      where: { coupleId: id, role: UserRole.ACCESS_AGENT },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        isActive: true,
        coupleId: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
    return agents.map(({ firstName, lastName, ...agent }) => ({
      ...agent,
      name: [firstName, lastName].filter(Boolean).join(' '),
    }));
  }

  async updateAccessAgent(id: string, agentId: string, dto: UpdateAccessAgentDto, actor: AuthUser) {
    await this.get(id, actor);
    const agent = await this.prisma.user.findFirst({
      where: { id: agentId, coupleId: id, role: UserRole.ACCESS_AGENT },
    });
    if (!agent) throw new NotFoundException('Agent de contrôle introuvable.');
    let phone: string | undefined;
    try {
      phone = dto.phone === undefined ? undefined : normalizePhoneNumber(dto.phone);
    } catch (error) {
      throw new BadRequestException({
        code: 'INVALID_PHONE_NUMBER',
        message: (error as Error).message,
      });
    }
    const parts = dto.name?.trim().split(/\s+/);
    let updated;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id: agentId },
          data: {
            ...(dto.name !== undefined
              ? { firstName: parts?.shift() || dto.name.trim(), lastName: parts?.join(' ') || null }
              : {}),
            ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() } : {}),
            ...(phone !== undefined ? { phone } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          },
        });
        if (dto.isActive === false)
          await tx.refreshSession.updateMany({
            where: { userId: agentId, OR: [{ revokedAt: null }, { revokedAt: { isSet: false } }] },
            data: { revokedAt: new Date() },
          });
        return user;
      });
    } catch (error) {
      this.duplicateAccountError(error);
    }
    void this.audit.record({
      userId: actor.sub,
      action: dto.isActive === false ? 'ACCESS_AGENT_DISABLED' : 'ACCESS_AGENT_UPDATED',
      entityType: 'User',
      entityId: agentId,
      metadata: { coupleId: id },
    });
    return {
      id: updated.id,
      name: [updated.firstName, updated.lastName].filter(Boolean).join(' '),
      email: updated.email,
      phone: updated.phone,
      coupleId: updated.coupleId,
      isActive: updated.isActive,
      createdAt: updated.createdAt,
      lastLoginAt: updated.lastLoginAt,
    };
  }

  async resetAccessAgentPassword(
    id: string,
    agentId: string,
    dto: ResetAccessAgentPasswordDto,
    actor: AuthUser,
  ) {
    await this.get(id, actor);
    const agent = await this.prisma.user.findFirst({
      where: { id: agentId, coupleId: id, role: UserRole.ACCESS_AGENT },
    });
    if (!agent) throw new NotFoundException('Agent de contrôle introuvable.');
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: agentId },
        data: { passwordHash: await argon2.hash(dto.password) },
      }),
      this.prisma.refreshSession.updateMany({
        where: { userId: agentId, OR: [{ revokedAt: null }, { revokedAt: { isSet: false } }] },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: actor.sub,
          action: 'ACCESS_AGENT_PASSWORD_RESET',
          entityType: 'User',
          entityId: agentId,
          metadata: { coupleId: id },
        },
      }),
    ]);
    return {
      id: agent.id,
      name: [agent.firstName, agent.lastName].filter(Boolean).join(' '),
      email: agent.email,
      phone: agent.phone,
      isActive: agent.isActive,
      coupleId: agent.coupleId,
      createdAt: agent.createdAt,
      lastLoginAt: agent.lastLoginAt,
    };
  }
}
