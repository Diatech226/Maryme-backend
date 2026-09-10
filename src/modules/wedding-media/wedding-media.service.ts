import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WeddingMedia } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuthUser } from '../../common/types/auth-user';
import { assertCoupleAccess } from '../../common/utils/ownership';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { UploadFile } from '../storage/upload-validation';
import { UpdateWeddingMediaDto, UploadWeddingMediaDto } from './dto/wedding-media.dto';
import { validateWeddingMedia } from './wedding-media.validation';

@Injectable()
export class WeddingMediaService {
  private readonly logger = new Logger(WeddingMediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private async assertCouple(coupleId: string, user: AuthUser): Promise<void> {
    assertCoupleAccess(user, coupleId);
    const couple = await this.prisma.couple.findFirst({
      where: { id: coupleId, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
      select: { id: true },
    });
    if (!couple) throw new NotFoundException('Couple not found');
  }

  private async media(coupleId: string, mediaId: string, user: AuthUser) {
    await this.assertCouple(coupleId, user);
    const media = await this.prisma.weddingMedia.findFirst({
      where: { id: mediaId, coupleId },
    });
    if (!media)
      throw new NotFoundException({
        code: 'WEDDING_MEDIA_NOT_FOUND',
        message: 'Wedding media not found',
      });
    return media;
  }

  private present(media: WeddingMedia) {
    return {
      id: media.id,
      slot: media.slot,
      label: media.label,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      width: media.width,
      height: media.height,
      createdAt: media.createdAt,
      updatedAt: media.updatedAt,
      hasFile: true,
    };
  }

  async list(coupleId: string, user: AuthUser) {
    await this.assertCouple(coupleId, user);
    const rows = await this.prisma.weddingMedia.findMany({
      where: { coupleId },
      orderBy: { slot: 'asc' },
    });
    return rows.map((row) => this.present(row));
  }

  async upload(
    coupleId: string,
    dto: UploadWeddingMediaDto,
    file: UploadFile | undefined,
    user: AuthUser,
  ) {
    await this.assertCouple(coupleId, user);
    this.assertSlot(dto.slot);
    const maxBytes = this.config.get<number>('WEDDING_MEDIA_MAX_UPLOAD_BYTES') ?? 5 * 1024 * 1024;
    validateWeddingMedia(file, maxBytes);
    const current = await this.prisma.weddingMedia.findUnique({
      where: { coupleId_slot: { coupleId, slot: dto.slot } },
    });
    if (!current && (await this.prisma.weddingMedia.count({ where: { coupleId } })) >= 3)
      throw new ConflictException({
        code: 'WEDDING_MEDIA_LIMIT_REACHED',
        message: 'A couple can store at most three wedding media files',
      });

    const objectKey = `couples/${coupleId}/wedding-media/${dto.slot}-${randomUUID()}`;
    // Prisma returns mutable plain objects. Preserve the old key before updating
    // metadata so cleanup can never target the replacement object.
    const previousObjectKey = current?.objectKey;
    await this.storage.put(objectKey, file.buffer, file.mimetype.toLowerCase());
    let saved: WeddingMedia;
    try {
      saved = current
        ? await this.prisma.weddingMedia.update({
            where: { id: current.id },
            data: {
              label: dto.label,
              objectKey,
              mimeType: file.mimetype.toLowerCase(),
              sizeBytes: file.size,
              // Dimensions are not calculated by the current upload pipeline. A
              // replacement must not retain dimensions that belonged to the old
              // binary.
              width: null,
              height: null,
            },
          })
        : await this.prisma.weddingMedia.create({
            data: {
              coupleId,
              slot: dto.slot,
              label: dto.label,
              objectKey,
              mimeType: file.mimetype.toLowerCase(),
              sizeBytes: file.size,
            },
          });
    } catch (error) {
      await this.storage
        .delete(objectKey)
        .catch(() => this.logger.error(`Failed to remove compensated GridFS object ${objectKey}`));
      throw error;
    }
    if (previousObjectKey)
      await this.storage
        .delete(previousObjectKey)
        .catch(() =>
          this.logger.warn(`Previous WeddingMedia object cleanup failed: ${current.id}`),
        );
    this.audit.record({
      userId: user.sub,
      action: current ? 'WEDDING_MEDIA_REPLACED' : 'WEDDING_MEDIA_CREATED',
      entityType: 'WeddingMedia',
      entityId: saved.id,
      metadata: { coupleId, slot: saved.slot },
    });
    return this.present(saved);
  }

  async download(coupleId: string, mediaId: string, user: AuthUser) {
    const media = await this.media(coupleId, mediaId, user);
    const stored = await this.storage.get(media.objectKey);
    return { ...stored, contentType: media.mimeType, sizeBytes: media.sizeBytes };
  }

  async update(coupleId: string, mediaId: string, dto: UpdateWeddingMediaDto, user: AuthUser) {
    const current = await this.media(coupleId, mediaId, user);
    if (dto.slot !== undefined) this.assertSlot(dto.slot);
    if (dto.slot !== undefined && dto.slot !== current.slot) {
      const occupied = await this.prisma.weddingMedia.findUnique({
        where: { coupleId_slot: { coupleId, slot: dto.slot } },
      });
      if (occupied)
        throw new ConflictException({
          code: 'WEDDING_MEDIA_SLOT_OCCUPIED',
          message: 'The requested wedding media slot is already occupied',
        });
    }
    const saved = await this.prisma.weddingMedia.update({
      where: { id: mediaId },
      data: dto,
    });
    this.audit.record({
      userId: user.sub,
      action: 'WEDDING_MEDIA_UPDATED',
      entityType: 'WeddingMedia',
      entityId: mediaId,
      metadata: { coupleId, slot: saved.slot },
    });
    return this.present(saved);
  }

  async remove(coupleId: string, mediaId: string, user: AuthUser): Promise<void> {
    const media = await this.media(coupleId, mediaId, user);
    await this.prisma.weddingMedia.delete({ where: { id: mediaId } });
    try {
      await this.storage.delete(media.objectKey);
    } catch (error) {
      // Restore discoverability if GridFS deletion failed, so the operation can be retried safely.
      await this.prisma.weddingMedia
        .create({ data: this.restoreData(media) })
        .catch(() => this.logger.error(`WeddingMedia delete compensation failed: ${media.id}`));
      throw error;
    }
    this.audit.record({
      userId: user.sub,
      action: 'WEDDING_MEDIA_DELETED',
      entityType: 'WeddingMedia',
      entityId: mediaId,
      metadata: { coupleId, slot: media.slot },
    });
  }

  private restoreData(media: WeddingMedia): Prisma.WeddingMediaUncheckedCreateInput {
    return {
      id: media.id,
      coupleId: media.coupleId,
      slot: media.slot,
      label: media.label,
      objectKey: media.objectKey,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      width: media.width,
      height: media.height,
      createdAt: media.createdAt,
      updatedAt: media.updatedAt,
    };
  }

  private assertSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 1 || slot > 3)
      throw new BadRequestException({
        code: 'WEDDING_MEDIA_SLOT_INVALID',
        message: 'Wedding media slot must be 1, 2, or 3',
      });
  }
}
