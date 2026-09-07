import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvitationDesignMode, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuthUser } from '../../common/types/auth-user';
import { assertCoupleAccess } from '../../common/utils/ownership';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { UploadFile, validateUpload } from '../storage/upload-validation';
import { CreateInvitationDesignDto, UpdateInvitationDesignDto } from './dto/invitation-design.dto';
@Injectable()
export class InvitationDesignsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private storage: StorageService,
    private config: ConfigService,
  ) {}
  private async couple(id: string, user: AuthUser) {
    assertCoupleAccess(user, id);
    const c = await this.prisma.couple.findFirst({
      where: { id, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
    });
    if (!c) throw new NotFoundException('Couple not found');
    return c;
  }
  private async design(coupleId: string, id: string, user: AuthUser) {
    await this.couple(coupleId, user);
    const d = await this.prisma.invitationDesign.findFirst({ where: { id, coupleId } });
    if (!d) throw new NotFoundException('Invitation design not found');
    return d;
  }
  list(coupleId: string, user: AuthUser) {
    return this.couple(coupleId, user).then(() =>
      this.prisma.invitationDesign.findMany({
        where: { coupleId },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }
  get(coupleId: string, id: string, user: AuthUser) {
    return this.design(coupleId, id, user);
  }
  async create(coupleId: string, dto: CreateInvitationDesignDto, user: AuthUser) {
    await this.couple(coupleId, user);
    if (dto.mode === InvitationDesignMode.GENERATED && !dto.templateKey)
      throw new BadRequestException('templateKey is required for a generated design');
    const d = await this.prisma.invitationDesign.create({
      data: {
        ...dto,
        overlayConfig: dto.overlayConfig as unknown as Prisma.InputJsonValue,
        contentConfig: dto.contentConfig as Prisma.InputJsonValue | undefined,
        coupleId,
      },
    });
    this.log(user, 'INVITATION_DESIGN_CREATED', d.id, { coupleId });
    return d;
  }
  async update(coupleId: string, id: string, dto: UpdateInvitationDesignDto, user: AuthUser) {
    await this.design(coupleId, id, user);
    const d = await this.prisma.invitationDesign.update({
      where: { id },
      data: {
        ...dto,
        overlayConfig: dto.overlayConfig as unknown as Prisma.InputJsonValue | undefined,
        contentConfig: dto.contentConfig as Prisma.InputJsonValue | undefined,
      },
    });
    this.log(user, 'INVITATION_DESIGN_UPDATED', id, { coupleId });
    return d;
  }
  async remove(coupleId: string, id: string, user: AuthUser) {
    await this.design(coupleId, id, user);
    if (await this.prisma.invitationArtifact.count({ where: { designId: id } }))
      throw new ConflictException({
        code: 'DESIGN_IN_USE',
        message: 'Design is used by an artifact',
      });
    await this.prisma.invitationDesign.delete({ where: { id } });
  }
  async activate(coupleId: string, id: string, user: AuthUser) {
    await this.design(coupleId, id, user);
    const [, d] = await this.prisma.$transaction([
      this.prisma.invitationDesign.updateMany({
        where: { coupleId, isActive: true },
        data: { isActive: false },
      }),
      this.prisma.invitationDesign.update({ where: { id }, data: { isActive: true } }),
    ]);
    this.log(user, 'INVITATION_DESIGN_ACTIVATED', id, { coupleId });
    return d;
  }
  async background(coupleId: string, id: string, file: UploadFile | undefined, user: AuthUser) {
    const d = await this.design(coupleId, id, user);
    const max = this.config.get<number>('STORAGE_MAX_UPLOAD_BYTES') ?? 10 * 1024 * 1024;
    validateUpload(file, max);
    const key = `couples/${coupleId}/designs/${id}/background-${randomUUID()}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    if (d.backgroundObjectKey) await this.storage.delete(d.backgroundObjectKey);
    const result = await this.prisma.invitationDesign.update({
      where: { id },
      data: {
        mode: InvitationDesignMode.UPLOADED,
        backgroundObjectKey: key,
        backgroundMimeType: file.mimetype,
      },
    });
    this.log(user, 'INVITATION_BACKGROUND_UPLOADED', id, { coupleId, mimeType: file.mimetype });
    return result;
  }
  private log(user: AuthUser, action: string, id: string, metadata: Prisma.InputJsonValue) {
    this.audit.record({
      userId: user.sub,
      action,
      entityType: 'InvitationDesign',
      entityId: id,
      metadata,
    });
  }
}
