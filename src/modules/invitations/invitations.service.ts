import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvitationStatus } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { AuthUser } from '../../common/types/auth-user';
import { assertCoupleAccess } from '../../common/utils/ownership';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateInvitationDto } from './dto/invitation.dto';
@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  hash(t: string) {
    return createHash('sha256').update(t).digest('hex');
  }
  async generate(guestId: string, dto: CreateInvitationDto, user: AuthUser) {
    const guest = await this.prisma.guest.findFirst({ where: { id: guestId, deletedAt: null } });
    if (!guest) throw new NotFoundException('Guest not found');
    assertCoupleAccess(user, guest.coupleId);
    if (dto.expiresAt && dto.expiresAt <= new Date())
      throw new BadRequestException('Expiration must be in the future');
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const invitation = await this.prisma.$transaction(async (tx) => {
      await tx.invitation.updateMany({
        where: { guestId, status: InvitationStatus.ACTIVE },
        data: { status: InvitationStatus.REVOKED, revokedAt: now },
      });
      return tx.invitation.create({
        data: {
          guestId,
          coupleId: guest.coupleId,
          tokenHash: this.hash(token),
          expiresAt: dto.expiresAt,
        },
      });
    });
    this.audit.record({
      userId: user.sub,
      action: 'INVITATION_GENERATED',
      entityType: 'Invitation',
      entityId: invitation.id,
    });
    const { tokenHash: _hash, ...safe } = invitation;
    return { ...safe, token, qrPayload: { version: 1, token } };
  }
  async list(guestId: string, user: AuthUser) {
    const guest = await this.prisma.guest.findFirst({ where: { id: guestId, deletedAt: null } });
    if (!guest) throw new NotFoundException('Guest not found');
    assertCoupleAccess(user, guest.coupleId);
    return this.prisma.invitation.findMany({
      where: { guestId },
      select: {
        id: true,
        coupleId: true,
        guestId: true,
        status: true,
        generatedAt: true,
        expiresAt: true,
        revokedAt: true,
        usedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
  async revoke(id: string, user: AuthUser) {
    const i = await this.prisma.invitation.findUnique({ where: { id } });
    if (!i) throw new NotFoundException('Invitation not found');
    assertCoupleAccess(user, i.coupleId);
    const result = await this.prisma.invitation.update({
      where: { id },
      data: { status: InvitationStatus.REVOKED, revokedAt: new Date() },
    });
    this.audit.record({
      userId: user.sub,
      action: 'INVITATION_REVOKED',
      entityType: 'Invitation',
      entityId: id,
    });
    const { tokenHash: _hash, ...safe } = result;
    return safe;
  }
}
