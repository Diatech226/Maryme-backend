import { BadRequestException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { AuthUser } from '../../common/types/auth-user';
import { assertCoupleAccess } from '../../common/utils/ownership';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService, StoredObject } from '../storage/storage.service';
import { UploadFile, validateUpload } from '../storage/upload-validation';
import { ArtifactListQueryDto, CreateShareLinkDto } from './dto/artifact.dto';
@Injectable()
export class InvitationArtifactsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private audit: AuditService,
    private config: ConfigService,
  ) {}
  private hash(v: string) {
    return createHash('sha256').update(v).digest('hex');
  }
  private async artifact(id: string, user: AuthUser) {
    const a = await this.prisma.invitationArtifact.findUnique({
      where: { id },
      include: { couple: true },
    });
    if (!a) throw new NotFoundException('Invitation artifact not found');
    assertCoupleAccess(user, a.coupleId);
    return a;
  }
  private present(a: any) {
    return {
      id: a.id,
      guestId: a.guestId,
      invitationId: a.invitationId,
      designId: a.designId,
      generatedAt: a.generatedAt,
      hasImage: !!a.imageObjectKey,
      hasPdf: !!a.pdfObjectKey,
      stale:
        a.guest.updatedAt > a.guestUpdatedAt ||
        a.design.updatedAt > a.designUpdatedAt ||
        !a.coupleUpdatedAt ||
        a.couple.updatedAt > a.coupleUpdatedAt,
    };
  }
  async create(
    invitationId: string,
    designId: string,
    image: UploadFile | undefined,
    pdf: UploadFile | undefined,
    user: AuthUser,
  ) {
    if (!image && !pdf) throw new BadRequestException('An image or PDF is required');
    const max = this.config.get<number>('STORAGE_MAX_UPLOAD_BYTES') ?? 10 * 1024 * 1024;
    if (image) validateUpload(image, max, ['image/png', 'image/jpeg', 'image/webp']);
    if (pdf) validateUpload(pdf, max, ['application/pdf']);
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
      include: { guest: true, couple: true },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    assertCoupleAccess(user, invitation.coupleId);
    const design = await this.prisma.invitationDesign.findFirst({
      where: { id: designId, coupleId: invitation.coupleId },
    });
    if (!design) throw new BadRequestException('Design does not belong to the invitation couple');
    const base = `couples/${invitation.coupleId}/artifacts/${randomUUID()}`;
    const uploaded: string[] = [];
    try {
      if (image) {
        await this.storage.put(`${base}/invitation-image`, image.buffer, image.mimetype);
        uploaded.push(`${base}/invitation-image`);
      }
      if (pdf) {
        await this.storage.put(`${base}/invitation.pdf`, pdf.buffer, pdf.mimetype);
        uploaded.push(`${base}/invitation.pdf`);
      }
      const a = await this.prisma.invitationArtifact.create({
        data: {
          coupleId: invitation.coupleId,
          guestId: invitation.guestId,
          invitationId,
          designId,
          imageObjectKey: image ? `${base}/invitation-image` : undefined,
          pdfObjectKey: pdf ? `${base}/invitation.pdf` : undefined,
          imageMimeType: image?.mimetype,
          pdfMimeType: pdf?.mimetype,
          guestUpdatedAt: invitation.guest.updatedAt,
          designUpdatedAt: design.updatedAt,
          coupleUpdatedAt: invitation.couple.updatedAt,
        },
      });
      this.log(user, 'INVITATION_ARTIFACT_CREATED', a.id, {
        invitationId,
        guestId: a.guestId,
        designId,
      });
      return {
        id: a.id,
        guestId: a.guestId,
        invitationId: a.invitationId,
        designId: a.designId,
        generatedAt: a.generatedAt,
        hasImage: !!a.imageObjectKey,
        hasPdf: !!a.pdfObjectKey,
        stale: false,
      };
    } catch (e) {
      await Promise.all(uploaded.map((k) => this.storage.delete(k)));
      throw e;
    }
  }
  async list(guestId: string, user: AuthUser) {
    const g = await this.prisma.guest.findUnique({ where: { id: guestId } });
    if (!g) throw new NotFoundException('Guest not found');
    assertCoupleAccess(user, g.coupleId);
    const rows = await this.prisma.invitationArtifact.findMany({
      where: { guestId },
      include: { guest: true, design: true, couple: true },
      orderBy: { generatedAt: 'desc' },
    });
    return rows.map((a) => this.present(a));
  }
  async listForCouple(coupleId: string, query: ArtifactListQueryDto, user: AuthUser) {
    assertCoupleAccess(user, coupleId);
    if (!(await this.prisma.couple.findUnique({ where: { id: coupleId } })))
      throw new NotFoundException('Couple not found');
    const where = { coupleId, ...(query.guestId ? { guestId: query.guestId } : {}) };
    const include = { guest: true, design: true, couple: true } as const;
    if (query.stale === undefined) {
      const [rows, total] = await this.prisma.$transaction([
        this.prisma.invitationArtifact.findMany({
          where,
          include,
          orderBy: { generatedAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.prisma.invitationArtifact.count({ where }),
      ]);
      return {
        data: rows.map((row) => this.present(row)),
        meta: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      };
    }
    const matching = (
      await this.prisma.invitationArtifact.findMany({
        where,
        include,
        orderBy: { generatedAt: 'desc' },
      })
    )
      .map((row) => this.present(row))
      .filter((artifact) => artifact.stale === query.stale);
    const total = matching.length;
    return {
      data: matching.slice((query.page - 1) * query.limit, query.page * query.limit),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }
  async download(id: string, format: 'image' | 'pdf', user: AuthUser) {
    const a = await this.artifact(id, user);
    const key = format === 'image' ? a.imageObjectKey : a.pdfObjectKey;
    if (!key) throw new NotFoundException(`Artifact has no ${format}`);
    const file = await this.storage.get(key);
    await this.prisma.invitationArtifact.update({
      where: { id },
      data: { lastDownloadedAt: new Date() },
    });
    this.log(user, 'INVITATION_ARTIFACT_DOWNLOADED', id, { format });
    return file;
  }
  async share(id: string, dto: CreateShareLinkDto, user: AuthUser) {
    const a = await this.artifact(id, user);
    const maximumDays = this.config.get<number>('SHARE_LINK_MAX_DAYS') ?? 30;
    const hardMax = new Date(Date.now() + maximumDays * 86400000);
    const fallback = new Date(a.couple.weddingDate.getTime() + 86400000);
    const requested = dto.expiresAt ?? a.couple.accessClosesAt ?? fallback;
    const expiresAt = requested < hardMax ? requested : hardMax;
    if (expiresAt <= new Date())
      throw new BadRequestException('Share link expiration must be in the future');
    const token = randomBytes(32).toString('base64url');
    const link = await this.prisma.$transaction(async (tx) => {
      const l = await tx.invitationShareLink.create({
        data: { artifactId: id, tokenHash: this.hash(token), expiresAt },
      });
      await tx.invitationArtifact.update({ where: { id }, data: { lastShareAt: new Date() } });
      return l;
    });
    this.log(user, 'INVITATION_SHARE_LINK_CREATED', link.id, {
      artifactId: id,
      expiresAt: expiresAt.toISOString(),
    });
    const base = this.config.get<string>('PUBLIC_API_URL') ?? 'http://localhost:4000/api/v1';
    return {
      id: link.id,
      shareUrl: `${base.replace(/\/$/, '')}/public/invitations/share/${token}`,
      expiresAt,
    };
  }
  async shareLinks(artifactId: string, user: AuthUser) {
    await this.artifact(artifactId, user);
    const links = await this.prisma.invitationShareLink.findMany({
      where: { artifactId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    // Raw validation tokens are never persisted, so an old URL cannot be reconstructed.
    return links.map(({ id, expiresAt, createdAt, openedAt }) => ({
      id,
      expiresAt,
      createdAt,
      openedAt,
    }));
  }
  async publicOpen(token: string): Promise<StoredObject> {
    const link = await this.prisma.invitationShareLink.findUnique({
      where: { tokenHash: this.hash(token) },
      include: { artifact: true },
    });
    if (!link) throw new NotFoundException('Share link not found');
    if (link.revokedAt) throw new GoneException('Share link revoked');
    if (link.expiresAt <= new Date()) throw new GoneException('Share link expired');
    const key = link.artifact.imageObjectKey ?? link.artifact.pdfObjectKey;
    if (!key) throw new NotFoundException('Artifact file not found');
    await this.prisma.invitationShareLink.update({
      where: { id: link.id },
      data: { openedAt: new Date() },
    });
    this.audit.record({
      action: 'INVITATION_SHARE_LINK_OPENED',
      entityType: 'InvitationShareLink',
      entityId: link.id,
      metadata: { artifactId: link.artifactId },
    });
    return this.storage.get(key);
  }
  async revoke(id: string, user: AuthUser) {
    const link = await this.prisma.invitationShareLink.findUnique({
      where: { id },
      include: { artifact: true },
    });
    if (!link) throw new NotFoundException('Share link not found');
    assertCoupleAccess(user, link.artifact.coupleId);
    const out = await this.prisma.invitationShareLink.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    this.log(user, 'INVITATION_SHARE_LINK_REVOKED', id, { artifactId: link.artifactId });
    return { id: out.id, revokedAt: out.revokedAt };
  }
  private log(user: AuthUser, action: string, id: string, metadata: Prisma.InputJsonValue) {
    this.audit.record({
      userId: user.sub,
      action,
      entityType: action.includes('SHARE_LINK') ? 'InvitationShareLink' : 'InvitationArtifact',
      entityId: id,
      metadata,
    });
  }
}
