import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvitationStatus, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/types/auth-user';
import { assertCoupleAccess } from '../../common/utils/ownership';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InvitationsService } from '../invitations/invitations.service';
import { CheckInQueryDto, CreateCheckInDto } from './dto/checkin.dto';

@Injectable()
export class CheckInsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationsService,
    private readonly audit: AuditService,
  ) {}
  private async resolve(token: string, user: AuthUser, deferUsedCheck = false) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: this.invitations.hash(token) },
      include: { guest: true, couple: true },
    });
    if (!invitation)
      throw new NotFoundException({ code: 'QR_INVALID', message: 'QR code invalide.' });
    assertCoupleAccess(user, invitation.coupleId);
    if (invitation.guest.deletedAt)
      throw new ForbiddenException({
        code: 'GUEST_DELETED',
        message: 'Cet invité a été supprimé.',
      });
    if (invitation.status === InvitationStatus.REVOKED || invitation.revokedAt)
      throw new ForbiddenException({ code: 'QR_REVOKED', message: 'QR code révoqué.' });
    if (invitation.usedAt && !deferUsedCheck)
      throw new ConflictException({ code: 'QR_ALREADY_USED', message: 'QR code déjà utilisé.' });
    if (invitation.expiresAt && invitation.expiresAt <= new Date()) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      void this.audit.record({
        action: 'QR_EXPIRED',
        entityType: 'Invitation',
        entityId: invitation.id,
        userId: user.sub,
        metadata: { coupleId: invitation.coupleId, guestId: invitation.guestId },
      });
      throw new ForbiddenException({ code: 'QR_EXPIRED', message: 'QR code expiré.' });
    }
    if (invitation.status === InvitationStatus.EXPIRED)
      throw new ForbiddenException({ code: 'QR_EXPIRED', message: 'QR code expiré.' });
    const now = new Date();
    if (invitation.couple.accessOpensAt && now < invitation.couple.accessOpensAt)
      throw new ForbiddenException({
        code: 'EVENT_NOT_OPEN',
        message: "Le contrôle d'accès n'est pas encore ouvert.",
      });
    if (invitation.couple.accessClosesAt && now > invitation.couple.accessClosesAt)
      throw new ForbiddenException({
        code: 'EVENT_CLOSED',
        message: "Le contrôle d'accès est fermé.",
      });
    return invitation;
  }
  async list(coupleId: string, q: CheckInQueryDto, user: AuthUser) {
    assertCoupleAccess(user, coupleId);
    const where: Prisma.CheckInWhereInput = {
      coupleId,
      ...(q.search
        ? {
            guest: {
              OR: [
                { firstName: { contains: q.search, mode: 'insensitive' } },
                { lastName: { contains: q.search, mode: 'insensitive' } },
                { tableNumber: { contains: q.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.checkIn.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { checkedInAt: 'desc' },
        include: {
          guest: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              tableNumber: true,
              assignedSeats: true,
              coupons: true,
            },
          },
          operator: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.checkIn.count({ where }),
    ]);
    return {
      data,
      meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
    };
  }
  async validate(token: string, user: AuthUser) {
    const invitation = await this.resolve(token, user);
    const exists = await this.prisma.checkIn.findUnique({ where: { guestId: invitation.guestId } });
    void this.audit.record({
      userId: user.sub,
      action: 'QR_VALIDATED',
      entityType: 'Invitation',
      entityId: invitation.id,
      metadata: { coupleId: invitation.coupleId, guestId: invitation.guestId },
    });
    return {
      valid: true,
      alreadyCheckedIn: Boolean(exists),
      guest: {
        id: invitation.guest.id,
        firstName: invitation.guest.firstName,
        lastName: invitation.guest.lastName,
        side: invitation.guest.side,
        category: invitation.guest.category,
        rsvpStatus: invitation.guest.rsvpStatus,
        tableNumber: invitation.guest.tableNumber,
        assignedSeats: invitation.guest.assignedSeats,
        coupons: invitation.guest.coupons,
        plusOne: invitation.guest.plusOne,
        isChild: invitation.guest.isChild,
      },
      ...(exists ? { checkedInAt: exists.checkedInAt, deviceId: exists.deviceId } : {}),
      warning:
        invitation.guest.rsvpStatus === 'PENDING'
          ? 'RSVP_PENDING'
          : invitation.guest.rsvpStatus === 'DECLINED'
            ? 'RSVP_DECLINED'
            : undefined,
    };
  }
  async create(dto: CreateCheckInDto, user: AuthUser) {
    const invitation = await this.resolve(dto.token, user, true);
    if (await this.prisma.checkIn.findUnique({ where: { guestId: invitation.guestId } })) {
      void this.audit.record({
        userId: user.sub,
        action: 'CHECKIN_DUPLICATE',
        entityType: 'Guest',
        entityId: invitation.guestId,
        metadata: {
          coupleId: invitation.coupleId,
          invitationId: invitation.id,
          deviceId: dto.deviceId,
        },
      });
      throw new ConflictException({
        code: 'GUEST_ALREADY_CHECKED_IN',
        message: 'Invité déjà enregistré.',
      });
    }
    if (invitation.usedAt)
      throw new ConflictException({ code: 'QR_ALREADY_USED', message: 'QR code déjà utilisé.' });
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const checkIn = await tx.checkIn.create({
          data: {
            guestId: invitation.guestId,
            coupleId: invitation.coupleId,
            invitationId: invitation.id,
            operatorId: user.sub,
            deviceId: dto.deviceId,
          },
          include: {
            guest: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                tableNumber: true,
                assignedSeats: true,
                coupons: true,
              },
            },
          },
        });
        await tx.invitation.update({ where: { id: invitation.id }, data: { usedAt: new Date() } });
        return checkIn;
      });
      void this.audit.record({
        userId: user.sub,
        action: 'CHECKIN_CREATED',
        entityType: 'CheckIn',
        entityId: result.id,
        metadata: {
          coupleId: invitation.coupleId,
          guestId: invitation.guestId,
          invitationId: invitation.id,
          deviceId: dto.deviceId,
        },
      });
      return result;
    } catch (error: unknown) {
      if (this.isConcurrentCheckInConflict(error)) {
        void this.audit.record({
          userId: user.sub,
          action: 'CHECKIN_DUPLICATE',
          entityType: 'Guest',
          entityId: invitation.guestId,
        });
        throw new ConflictException({
          code: 'GUEST_ALREADY_CHECKED_IN',
          message: 'Invité déjà enregistré.',
        });
      }
      throw error;
    }
  }

  private isConcurrentCheckInConflict(error: unknown): boolean {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2002', 'P2034'].includes(error.code)
    )
      return true;
    const serialized =
      error instanceof Error
        ? `${error.name} ${error.message} ${JSON.stringify(error)}`
        : String(error);
    return /write conflict|transaction conflict|TransientTransactionError/i.test(serialized);
  }
}
