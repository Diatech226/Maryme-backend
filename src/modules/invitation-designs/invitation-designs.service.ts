import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
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
  private readonly logger = new Logger(InvitationDesignsService.name);
  private readonly activationLocks = new Map<string, Promise<void>>();
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
    if (!d)
      throw new NotFoundException({
        code: 'INVITATION_DESIGN_NOT_FOUND',
        message: 'Invitation design not found',
      });
    return d;
  }
  private present<T extends { backgroundObjectKey: string | null }>(design: T) {
    const { backgroundObjectKey, ...safe } = design;
    return { ...safe, hasBackground: !!backgroundObjectKey };
  }
  list(coupleId: string, user: AuthUser) {
    return this.couple(coupleId, user).then(() =>
      this.prisma.invitationDesign
        .findMany({
          where: { coupleId },
          orderBy: { createdAt: 'desc' },
        })
        .then((rows) => rows.map((row) => this.present(row))),
    );
  }
  get(coupleId: string, id: string, user: AuthUser) {
    return this.design(coupleId, id, user).then((design) => this.present(design));
  }
  async create(coupleId: string, dto: CreateInvitationDesignDto, user: AuthUser) {
    await this.couple(coupleId, user);
    if (dto.mode === InvitationDesignMode.GENERATED && !dto.templateKey)
      throw new BadRequestException('templateKey is required for a generated design');
    if (dto.mode === InvitationDesignMode.UPLOADED && dto.templateKey)
      throw new BadRequestException('templateKey cannot be used by an uploaded design');
    const d = await this.prisma.invitationDesign.create({
      data: {
        ...dto,
        // An imported design is only activatable after its background is safely stored.
        // Keep this explicit so a future schema/default change cannot skip that workflow.
        ...(dto.mode === InvitationDesignMode.UPLOADED ? { isActive: false } : {}),
        overlayConfig: dto.overlayConfig as unknown as Prisma.InputJsonValue,
        contentConfig: dto.contentConfig as Prisma.InputJsonValue | undefined,
        coupleId,
      },
    });
    this.log(user, 'INVITATION_DESIGN_CREATED', d.id, { coupleId });
    return this.present(d);
  }
  async update(coupleId: string, id: string, dto: UpdateInvitationDesignDto, user: AuthUser) {
    const current = await this.design(coupleId, id, user);
    if (dto.mode !== undefined && dto.mode !== current.mode)
      throw new ConflictException({
        code: 'INVITATION_DESIGN_WRONG_MODE',
        message: 'Create a separate design to try another mode; existing uploads are preserved',
      });
    const mode = dto.mode ?? current.mode;
    const templateKey = dto.templateKey ?? current.templateKey;
    if (mode === InvitationDesignMode.GENERATED && !templateKey)
      throw new BadRequestException('templateKey is required for a generated design');
    if (mode === InvitationDesignMode.UPLOADED && dto.templateKey)
      throw new BadRequestException('templateKey cannot be used by an uploaded design');
    const d = await this.prisma.invitationDesign.update({
      where: { id },
      data: {
        ...dto,
        overlayConfig: dto.overlayConfig as unknown as Prisma.InputJsonValue | undefined,
        contentConfig: dto.contentConfig as Prisma.InputJsonValue | undefined,
      },
    });
    this.log(user, 'INVITATION_DESIGN_UPDATED', id, { coupleId });
    return this.present(d);
  }
  async remove(coupleId: string, id: string, user: AuthUser) {
    const design = await this.design(coupleId, id, user);
    if (await this.prisma.invitationArtifact.count({ where: { designId: id } }))
      throw new ConflictException({
        code: 'DESIGN_IN_USE',
        message: 'Design is used by an artifact',
      });
    await this.prisma.invitationDesign.delete({ where: { id } });
    if (design.backgroundObjectKey)
      await this.storage
        .delete(design.backgroundObjectKey)
        .catch(() => this.logger.warn('Deleted design background cleanup failed'));
  }
  async activate(coupleId: string, id: string, user: AuthUser) {
    const design = await this.design(coupleId, id, user);
    if (design.mode === InvitationDesignMode.UPLOADED && !design.backgroundObjectKey)
      throw new BadRequestException({
        code: 'INVITATION_BACKGROUND_MISSING',
        message: 'Upload a background before activating this design',
      });
    if (design.mode === InvitationDesignMode.GENERATED && !design.templateKey)
      throw new BadRequestException('Generated design has no template');
    const previous = this.activationLocks.get(coupleId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    this.activationLocks.set(coupleId, current);
    await previous;
    try {
      const [, d] = await this.prisma.$transaction([
        this.prisma.invitationDesign.updateMany({
          where: { coupleId, isActive: true },
          data: { isActive: false },
        }),
        this.prisma.invitationDesign.update({ where: { id }, data: { isActive: true } }),
      ]);
      this.log(user, 'INVITATION_DESIGN_ACTIVATED', id, { coupleId });
      return this.present(d);
    } finally {
      release();
      if (this.activationLocks.get(coupleId) === current) this.activationLocks.delete(coupleId);
    }
  }
  async background(coupleId: string, id: string, file: UploadFile | undefined, user: AuthUser) {
    const d = await this.design(coupleId, id, user);
    if (d.mode !== InvitationDesignMode.UPLOADED)
      throw new ConflictException({
        code: 'INVITATION_DESIGN_WRONG_MODE',
        message: 'Backgrounds can only be uploaded to an UPLOADED design',
      });
    const max = this.config.get<number>('STORAGE_MAX_UPLOAD_BYTES') ?? 10 * 1024 * 1024;
    validateUpload(file, max, ['image/png', 'image/jpeg', 'image/webp']);
    this.logger.log(
      JSON.stringify({
        event: 'INVITATION_BACKGROUND_UPLOAD_START',
        stage: 'validation-complete',
        designId: id,
        coupleId,
        mimeType: file.mimetype,
        size: file.size,
      }),
    );
    const key = `couples/${coupleId}/designs/${id}/background-${randomUUID()}`;
    try {
      await this.storage.put(key, file.buffer, file.mimetype);
      this.logger.log(
        JSON.stringify({ event: 'INVITATION_BACKGROUND_STORAGE_OK', designId: id, coupleId }),
      );
    } catch (error) {
      this.logUploadFailure('gridfs-write', id, coupleId, file, error);
      throw error;
    }
    let result;
    try {
      result = await this.prisma.invitationDesign.update({
        where: { id },
        data: {
          backgroundObjectKey: key,
          backgroundMimeType: file.mimetype,
        },
      });
      this.logger.log(
        JSON.stringify({ event: 'INVITATION_BACKGROUND_DB_OK', designId: id, coupleId }),
      );
    } catch (error) {
      await this.storage
        .delete(key)
        .catch((cleanupError) =>
          this.logUploadFailure('compensation-delete', id, coupleId, file, cleanupError),
        );
      this.logUploadFailure('prisma-update', id, coupleId, file, error);
      throw error;
    }
    // The database must point at the new object before the previous one is removed.
    // A failed cleanup only leaves an inaccessible orphan; it never breaks the design.
    if (d.backgroundObjectKey) {
      await this.storage
        .delete(d.backgroundObjectKey)
        .catch(() => this.logger.warn('Previous invitation background cleanup failed'));
    }
    this.log(user, 'INVITATION_BACKGROUND_UPLOADED', id, { coupleId, mimeType: file.mimetype });
    return this.present(result);
  }
  async downloadBackground(coupleId: string, id: string, user: AuthUser) {
    const design = await this.design(coupleId, id, user);
    if (!design.backgroundObjectKey)
      throw new NotFoundException({
        code: 'INVITATION_BACKGROUND_MISSING',
        message: 'Design has no background',
      });
    const stored = await this.storage.get(design.backgroundObjectKey);
    this.logger.log(
      JSON.stringify({ event: 'INVITATION_BACKGROUND_READ_OK', designId: id, coupleId }),
    );
    return stored;
  }
  private logUploadFailure(
    stage: string,
    designId: string,
    coupleId: string,
    file: UploadFile,
    error: unknown,
  ) {
    const response =
      error && typeof error === 'object' && 'getResponse' in error
        ? (error as { getResponse(): unknown }).getResponse()
        : undefined;
    const errorCode =
      response && typeof response === 'object' && 'code' in response
        ? String((response as { code: unknown }).code)
        : 'INTERNAL_ERROR';
    this.logger.error(
      JSON.stringify({
        event: 'INVITATION_BACKGROUND_UPLOAD_FAILED',
        stage,
        designId,
        coupleId,
        mimeType: file.mimetype,
        size: file.size,
        errorCode,
      }),
    );
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
