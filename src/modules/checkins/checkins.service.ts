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
  private async resolve(token: string, user: AuthUser) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: this.invitations.hash(token) },
      include: { guest: true },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    assertCoupleAccess(user, invitation.coupleId);
    if (invitation.status !== InvitationStatus.ACTIVE || invitation.revokedAt)
      throw new ForbiddenException('Invitation is not active');
    if (invitation.usedAt) throw new ForbiddenException('Invitation has already been used');
    if (invitation.expiresAt && invitation.expiresAt <= new Date()) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new ForbiddenException('Invitation expired');
    }
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
    return {
      valid: true,
      alreadyCheckedIn: Boolean(exists),
      guest: {
        id: invitation.guest.id,
        coupleId: invitation.guest.coupleId,
        firstName: invitation.guest.firstName,
        lastName: invitation.guest.lastName,
        side: invitation.guest.side,
        category: invitation.guest.category,
        rsvpStatus: invitation.guest.rsvpStatus,
        dietary: invitation.guest.dietary,
        tableNumber: invitation.guest.tableNumber,
        assignedSeats: invitation.guest.assignedSeats,
        coupons: invitation.guest.coupons,
        plusOne: invitation.guest.plusOne,
        isChild: invitation.guest.isChild,
        lodgingNeeded: invitation.guest.lodgingNeeded,
      },
    };
  }
  async create(dto: CreateCheckInDto, user: AuthUser) {
    const invitation = await this.resolve(dto.token, user);
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
      });
      return result;
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        void this.audit.record({
          userId: user.sub,
          action: 'CHECKIN_DUPLICATE',
          entityType: 'Guest',
          entityId: invitation.guestId,
        });
        throw new ConflictException('Guest is already checked in');
      }
      throw error;
    }
  }
}
