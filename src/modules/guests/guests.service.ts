import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InvitationStatus, Prisma } from '@prisma/client';
import { assertCoupleAccess } from '../../common/utils/ownership';
import { AuthUser } from '../../common/types/auth-user';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CouponPoolService } from '../coupons/coupon-pool.service';
import {
  BulkCreateGuestsDto,
  BulkGuestsMode,
  CreateGuestDto,
  GuestQueryDto,
  GuestImportDto,
  ImportGuestRowDto,
  MarkInvitationsSentDto,
  UpdateGuestDto,
} from './dto/guest.dto';
import { assertQuota } from './quota';
@Injectable()
export class GuestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly couponPool: CouponPoolService,
  ) {}
  private async couple(id: string, user: AuthUser) {
    assertCoupleAccess(user, id);
    const c = await this.prisma.couple.findFirst({
      where: { id, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
    });
    if (!c) throw new NotFoundException('Couple not found');
    return c;
  }
  private async used(id: string) {
    return (
      (
        await this.prisma.guest.aggregate({
          where: { coupleId: id, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
          _sum: { coupons: true },
        })
      )._sum.coupons ?? 0
    );
  }
  private async guestData(
    tx: Prisma.TransactionClient | PrismaService,
    coupleId: string,
    dto: CreateGuestDto | UpdateGuestDto,
    current?: { id: string; side: CreateGuestDto['side']; coupons: number },
  ): Promise<Prisma.GuestUncheckedCreateInput | Prisma.GuestUncheckedUpdateInput> {
    const { tableNumber, tableId, ...fields } = dto;
    if (tableId === undefined && tableNumber === undefined)
      return fields as Prisma.GuestUncheckedUpdateInput;
    const table = await tx.weddingTable.findFirst({
      where: {
        coupleId,
        ...(tableId ? { id: tableId } : { number: tableNumber }),
      },
      include: {
        guests: {
          where: {
            ...(current ? { id: { not: current.id } } : {}),
            OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }],
          },
          select: { coupons: true },
        },
      },
    });
    if (!table)
      throw new NotFoundException(
        `Wedding table ${tableNumber ?? tableId} not found for this couple`,
      );
    const side = dto.side ?? current?.side;
    if (side && table.side !== side)
      throw new ConflictException('Guest side does not match table side');
    const coupons = dto.coupons ?? current?.coupons ?? 1;
    const occupied = table.guests.reduce((sum, guest) => sum + guest.coupons, 0);
    if (table.capacity != null && occupied + coupons > table.capacity)
      throw new ConflictException('Table capacity exceeded');
    return {
      ...fields,
      tableId: table.id,
      tableNumber: String(table.number),
    } as Prisma.GuestUncheckedUpdateInput;
  }
  async list(id: string, q: GuestQueryDto, user: AuthUser) {
    await this.couple(id, user);
    const and: Prisma.GuestWhereInput[] = [
      { OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
    ];
    if (q.hasPhone !== undefined)
      and.push(
        q.hasPhone
          ? { AND: [{ phone: { not: null } }, { phone: { not: '' } }] }
          : { OR: [{ phone: null }, { phone: '' }, { phone: { isSet: false } }] },
      );
    if (q.invitationSent !== undefined)
      and.push(
        q.invitationSent
          ? { invitationSentDate: { not: null } }
          : {
              OR: [{ invitationSentDate: null }, { invitationSentDate: { isSet: false } }],
            },
      );
    const where: Prisma.GuestWhereInput = {
      coupleId: id,
      AND: and,
      ...(q.search
        ? {
            OR: [
              { firstName: { contains: q.search, mode: 'insensitive' } },
              { lastName: { contains: q.search, mode: 'insensitive' } },
              { phone: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(q.side ? { side: q.side } : {}),
      ...(q.family ? { family: q.family } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.rsvpStatus ? { rsvpStatus: q.rsvpStatus } : {}),
      ...(q.tableNumber ? { tableNumber: q.tableNumber } : {}),
      ...(q.checkedIn === undefined ? {} : { checkIn: q.checkedIn ? { isNot: null } : null }),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.guest.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          invitations: { select: { id: true }, take: 1 },
          invitationArtifacts: { select: { id: true }, take: 1 },
          checkIn: { select: { id: true } },
        },
      }),
      this.prisma.guest.count({ where }),
    ]);
    return {
      data: data.map(({ invitations, invitationArtifacts, checkIn, ...guest }) => ({
        ...guest,
        hasInvitation: invitations.length > 0,
        hasArtifact: invitationArtifacts.length > 0,
        checkedIn: Boolean(checkIn),
      })),
      meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
    };
  }
  async create(id: string, dto: CreateGuestDto, user: AuthUser) {
    const c = await this.couple(id, user);
    assertQuota(await this.used(id), dto.coupons, c.guestQuota);
    const g = await this.prisma.$transaction(async (tx) => {
      const data = await this.guestData(tx, id, dto);
      const guest = await tx.guest.create({
        data: { ...data, coupleId: id } as Prisma.GuestUncheckedCreateInput,
      });
      await this.couponPool.ensurePool(id, c.guestQuota, tx);
      await this.couponPool.assignLowest(guest.id, guest.coupons, tx);
      return guest;
    });
    this.audit.record({
      userId: user.sub,
      action: 'GUEST_CREATED',
      entityType: 'Guest',
      entityId: g.id,
    });
    return g;
  }
  async bulk(id: string, dto: BulkCreateGuestsDto, user: AuthUser) {
    const c = await this.couple(id, user);
    const incoming = dto.guests.reduce((n, g) => n + g.coupons, 0);
    assertQuota(
      dto.mode === BulkGuestsMode.REPLACE ? 0 : await this.used(id),
      incoming,
      c.guestQuota,
    );
    await this.prisma.$transaction(async (tx) => {
      await this.couponPool.ensurePool(id, c.guestQuota, tx);
      if (dto.mode === BulkGuestsMode.REPLACE) {
        if (await tx.checkIn.count({ where: { coupleId: id } }))
          throw new ConflictException(
            'Impossible de remplacer les invités après le début des contrôles d’entrée.',
          );
        // Invitations contain token hashes tied to the old guest set: deleting them
        // atomically revokes every previously issued QR code before guests are replaced.
        await tx.invitation.deleteMany({ where: { coupleId: id } });
        await tx.coupon.updateMany({
          where: { coupleId: id, status: 'ASSIGNED' },
          data: { guestId: null, status: 'AVAILABLE', assignedAt: null, releasedAt: new Date() },
        });
        await tx.guest.deleteMany({ where: { coupleId: id } });
      }
      for (const guest of dto.guests) {
        const data = await this.guestData(tx, id, guest);
        const created = await tx.guest.create({
          data: { ...data, coupleId: id } as Prisma.GuestUncheckedCreateInput,
        });
        await this.couponPool.assignLowest(created.id, created.coupons, tx);
      }
    });
    void this.audit.record({
      userId: user.sub,
      action: dto.mode === BulkGuestsMode.REPLACE ? 'GUESTS_REPLACED' : 'GUESTS_IMPORTED',
      entityType: 'Couple',
      entityId: id,
      metadata: { count: dto.guests.length },
    });
    return { created: dto.guests.length, failed: 0 };
  }
  async importGuests(id: string, dto: GuestImportDto, user: AuthUser) {
    const couple = await this.couple(id, user);
    if (dto.mode !== BulkGuestsMode.MERGE)
      return this.bulk(
        id,
        { mode: dto.mode, guests: dto.guests.map((row) => this.toCreate(row)) },
        user,
      );
    await this.couponPool.ensurePool(id, couple.guestQuota);
    const existing = await this.prisma.guest.findMany({
      where: { coupleId: id, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
      include: { couponNumbers: true, checkIn: true },
    });
    const norm = (value?: string | null) =>
      (value ?? '')
        .trim()
        .toLocaleLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    const phone = (value?: string | null) => (value ?? '').replace(/\D/g, '');
    const rows = dto.guests.map((row, index) => {
      const candidates = (predicate: (guest: (typeof existing)[number]) => boolean) =>
        existing.filter(predicate);
      let matches = row.guestId ? candidates((g) => g.id === row.guestId) : [];
      if (!matches.length && row.externalRef)
        matches = candidates((g) => norm(g.externalRef) === norm(row.externalRef));
      if (!matches.length && row.email)
        matches = candidates((g) => Boolean(g.email) && norm(g.email) === norm(row.email));
      if (!matches.length && row.phone)
        matches = candidates((g) => Boolean(g.phone) && phone(g.phone) === phone(row.phone));
      if (!matches.length)
        matches = candidates(
          (g) =>
            norm(g.firstName) === norm(row.firstName) &&
            norm(g.lastName) === norm(row.lastName) &&
            g.side === row.side &&
            norm(g.family) === norm(row.family),
        );
      if (matches.length > 1)
        return {
          index,
          action: 'CONFLICT' as const,
          code: 'IMPORT_AMBIGUOUS_MATCH',
          changes: {},
          row,
        };
      if (!matches.length) return { index, action: 'CREATE' as const, changes: {}, row };
      const guest = matches[0];
      const changes: Record<string, unknown> = {};
      for (const key of [
        'externalRef',
        'firstName',
        'lastName',
        'side',
        'family',
        'coupons',
        'category',
        'rsvpStatus',
        'dietary',
        'plusOne',
        'plusOneName',
        'isChild',
        'tableId',
        'tableNumber',
        'phone',
        'email',
        'lodgingNeeded',
        'notes',
      ] as const) {
        const value = row[key];
        if (value === undefined || value === '') continue;
        const next = value === '__CLEAR__' ? null : value;
        if (guest[key] !== next) changes[key] = next;
      }
      if ((changes.coupons !== undefined || row.couponNumbers) && guest.checkIn)
        return {
          index,
          action: 'CONFLICT' as const,
          code: 'COUPON_ALREADY_USED',
          changes,
          row,
          guest,
        };
      return {
        index,
        action:
          Object.keys(changes).length || row.couponNumbers
            ? ('UPDATE' as const)
            : ('UNCHANGED' as const),
        changes,
        row,
        guest,
      };
    });
    const conflicts = rows.filter((r) => r.action === 'CONFLICT').length;
    const beforeAvailable = await this.prisma.coupon.count({
      where: { coupleId: id, status: 'AVAILABLE' },
    });
    const requested =
      rows
        .filter((r) => r.action === 'CREATE')
        .reduce((n, r) => n + (r.row.coupons ?? r.row.couponNumbers?.length ?? 1), 0) +
      rows
        .filter((r) => r.action === 'UPDATE')
        .reduce(
          (n, r) =>
            n +
            Math.max(
              0,
              Number((r.changes as Record<string, unknown>).coupons ?? r.guest!.coupons) -
                r.guest!.coupons,
            ),
          0,
        );
    const response = {
      summary: {
        rows: rows.length,
        create: rows.filter((r) => r.action === 'CREATE').length,
        update: rows.filter((r) => r.action === 'UPDATE').length,
        unchanged: rows.filter((r) => r.action === 'UNCHANGED').length,
        conflicts,
      },
      coupons: {
        beforeAvailable,
        afterAvailable: beforeAvailable - requested,
        newAssignments: requested,
        released: 0,
      },
      rows: rows.map(({ guest, row, ...result }) => ({ ...result, guestId: guest?.id })),
    };
    if (dto.dryRun) {
      this.audit.record({
        userId: user.sub,
        action: 'GUEST_IMPORT_PREVIEWED',
        entityType: 'Couple',
        entityId: id,
        metadata: response.summary,
      });
      return response;
    }
    if (conflicts)
      throw new ConflictException({
        code: 'IMPORT_AMBIGUOUS_MATCH',
        message: "L'import contient des conflits; aucun changement appliqué.",
        rows: response.rows,
      });
    await this.prisma.$transaction(async (tx) => {
      for (const plan of rows) {
        if (plan.action === 'UNCHANGED') continue;
        let guestId: string;
        let count: number;
        if (plan.action === 'CREATE') {
          const input = this.toCreate(plan.row);
          const data = await this.guestData(tx, id, input);
          const guest = await tx.guest.create({
            data: {
              ...data,
              externalRef: plan.row.externalRef,
              coupleId: id,
            } as Prisma.GuestUncheckedCreateInput,
          });
          guestId = guest.id;
          count = guest.coupons;
        } else {
          const data = await this.guestData(tx, id, plan.changes as UpdateGuestDto, plan.guest);
          const guest = await tx.guest.update({
            where: { id: plan.guest!.id },
            data,
          });
          guestId = guest.id;
          count = guest.coupons;
        }
        if (plan.row.couponNumbers)
          await this.assignImportedNumbers(tx, id, guestId, count, plan.row.couponNumbers);
        else if (dto.autoAssignCoupons) await this.couponPool.syncCount(guestId, count, tx);
      }
    });
    this.audit.record({
      userId: user.sub,
      action: 'GUESTS_MERGED',
      entityType: 'Couple',
      entityId: id,
      metadata: response.summary,
    });
    return response;
  }
  private toCreate(row: ImportGuestRowDto): CreateGuestDto {
    return {
      firstName: row.firstName,
      lastName: row.lastName,
      side: row.side,
      family: row.family,
      coupons: row.coupons ?? row.couponNumbers?.length ?? 1,
      category: row.category ?? ('FRIENDS' as CreateGuestDto['category']),
      rsvpStatus: row.rsvpStatus,
      dietary: row.dietary,
      plusOne: row.plusOne,
      plusOneName: row.plusOneName,
      isChild: row.isChild,
      tableId: row.tableId,
      tableNumber: row.tableNumber,
      phone: row.phone,
      email: row.email,
      lodgingNeeded: row.lodgingNeeded,
      notes: row.notes,
    };
  }
  private async assignImportedNumbers(
    tx: Prisma.TransactionClient,
    coupleId: string,
    guestId: string,
    count: number,
    numbers: number[],
  ) {
    if (numbers.length !== count)
      throw new ConflictException({
        code: 'COUPON_COUNT_MISMATCH',
        message: 'Nombre de coupons incohérent.',
      });
    const selected = await tx.coupon.findMany({ where: { coupleId, number: { in: numbers } } });
    if (selected.length !== numbers.length)
      throw new ConflictException({ code: 'COUPON_NOT_FOUND', message: 'Coupon inexistant.' });
    if (selected.some((c) => c.status === 'USED'))
      throw new ConflictException({ code: 'COUPON_ALREADY_USED', message: 'Coupon utilisé.' });
    if (selected.some((c) => c.guestId && c.guestId !== guestId))
      throw new ConflictException({
        code: 'COUPON_ALREADY_ASSIGNED',
        message: 'Coupon attribué à un autre invité.',
      });
    await tx.coupon.updateMany({
      where: { guestId, status: 'ASSIGNED', number: { notIn: numbers } },
      data: { guestId: null, status: 'AVAILABLE', assignedAt: null, releasedAt: new Date() },
    });
    await tx.coupon.updateMany({
      where: { coupleId, number: { in: numbers } },
      data: { guestId, status: 'ASSIGNED', assignedAt: new Date(), releasedAt: null },
    });
  }
  async get(id: string, user: AuthUser) {
    const g = await this.prisma.guest.findFirst({
      where: { id, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
    });
    if (!g) throw new NotFoundException('Guest not found');
    assertCoupleAccess(user, g.coupleId);
    return g;
  }
  async invitationStatus(id: string, user: AuthUser) {
    const guest = await this.prisma.guest.findFirst({
      where: { id, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
      include: {
        couple: { select: { updatedAt: true } },
        checkIn: { select: { id: true } },
        invitations: {
          orderBy: { generatedAt: 'desc' },
          take: 1,
          select: {
            id: true,
            artifacts: {
              orderBy: { generatedAt: 'desc' },
              take: 1,
              include: { design: { select: { updatedAt: true } } },
            },
          },
        },
      },
    });
    if (!guest) throw new NotFoundException('Guest not found');
    assertCoupleAccess(user, guest.coupleId);
    const invitation = guest.invitations[0];
    const artifact = invitation?.artifacts[0];
    const stale = Boolean(
      artifact &&
      (guest.updatedAt > artifact.guestUpdatedAt ||
        artifact.design.updatedAt > artifact.designUpdatedAt ||
        !artifact.coupleUpdatedAt ||
        guest.couple.updatedAt > artifact.coupleUpdatedAt),
    );
    return {
      guestId: guest.id,
      generated: Boolean(invitation),
      artifactReady: Boolean(artifact),
      cardStatus: !invitation ? 'NOT_GENERATED' : stale ? 'STALE' : 'GENERATED',
      sent: Boolean(guest.invitationSentDate),
      sentAt: guest.invitationSentDate,
      checkedIn: Boolean(guest.checkIn),
    };
  }
  async markInvitationSent(id: string, user: AuthUser) {
    const guest = await this.get(id, user);
    const invitationSentDate = guest.invitationSentDate ?? new Date();
    if (!guest.invitationSentDate) {
      await this.prisma.guest.update({ where: { id }, data: { invitationSentDate } });
      this.audit.record({
        userId: user.sub,
        action: 'INVITATION_SENT',
        entityType: 'Guest',
        entityId: id,
        metadata: { coupleId: guest.coupleId },
      });
    }
    return { guestId: id, invitationSentDate };
  }
  async markInvitationsSent(coupleId: string, dto: MarkInvitationsSentDto, user: AuthUser) {
    await this.couple(coupleId, user);
    const guests = await this.prisma.guest.findMany({
      where: {
        id: { in: dto.guestIds },
        coupleId,
        OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }],
      },
      select: { id: true },
    });
    const accepted = new Set(guests.map((guest) => guest.id));
    const failed = dto.guestIds.filter((id) => !accepted.has(id));
    if (accepted.size) {
      await this.prisma.guest.updateMany({
        where: {
          id: { in: [...accepted] },
          OR: [{ invitationSentDate: null }, { invitationSentDate: { isSet: false } }],
        },
        data: { invitationSentDate: new Date() },
      });
      this.audit.record({
        userId: user.sub,
        action: 'INVITATION_SENT',
        entityType: 'Couple',
        entityId: coupleId,
        metadata: { coupleId, count: accepted.size },
      });
    }
    return { updated: accepted.size, failed };
  }
  async update(id: string, dto: UpdateGuestDto, user: AuthUser) {
    const g = await this.get(id, user);
    if (dto.coupons) {
      const c = await this.couple(g.coupleId, user);
      assertQuota((await this.used(g.coupleId)) - g.coupons, dto.coupons, c.guestQuota);
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const data = await this.guestData(tx, g.coupleId, dto, g);
      const updated = await tx.guest.update({ where: { id }, data });
      if (dto.coupons !== undefined) await this.couponPool.syncCount(id, dto.coupons, tx);
      return updated;
    });
    this.audit.record({
      userId: user.sub,
      action: 'GUEST_UPDATED',
      entityType: 'Guest',
      entityId: id,
    });
    return result;
  }
  async remove(id: string, user: AuthUser) {
    await this.get(id, user);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.coupon.updateMany({
        where: { guestId: id, status: 'ASSIGNED' },
        data: { guestId: null, status: 'AVAILABLE', assignedAt: null, releasedAt: now },
      });
      await tx.guest.update({ where: { id }, data: { deletedAt: now } });
      await tx.invitation.updateMany({
        where: { guestId: id, status: InvitationStatus.ACTIVE },
        data: { status: InvitationStatus.REVOKED, revokedAt: now },
      });
    });
    this.audit.record({
      userId: user.sub,
      action: 'GUEST_DELETED',
      entityType: 'Guest',
      entityId: id,
    });
  }
}
