import { BadRequestException } from '@nestjs/common';
import { UploadFile } from '../storage/upload-validation';

export const WEDDING_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const matchesSignature: Record<(typeof WEDDING_MEDIA_TYPES)[number], (body: Buffer) => boolean> = {
  'image/jpeg': (body) =>
    body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff,
  'image/png': (body) =>
    body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/webp': (body) =>
    body.length >= 12 &&
    body.subarray(0, 4).toString('ascii') === 'RIFF' &&
    body.subarray(8, 12).toString('ascii') === 'WEBP',
};

export function validateWeddingMedia(
  file: UploadFile | undefined,
  maxBytes: number,
): asserts file is UploadFile {
  if (!file)
    throw new BadRequestException({
      code: 'WEDDING_MEDIA_FILE_REQUIRED',
      message: 'An image file is required',
    });
  if (file.size > maxBytes)
    throw new BadRequestException({
      code: 'WEDDING_MEDIA_TOO_LARGE',
      message: `Wedding media must not exceed ${maxBytes} bytes`,
    });
  const mimeType = file.mimetype.toLowerCase();
  if (
    !WEDDING_MEDIA_TYPES.includes(mimeType as (typeof WEDDING_MEDIA_TYPES)[number]) ||
    !matchesSignature[mimeType as (typeof WEDDING_MEDIA_TYPES)[number]]?.(file.buffer)
  )
    throw new BadRequestException({
      code: 'WEDDING_MEDIA_UNSUPPORTED_TYPE',
      message: 'Only valid JPEG, PNG, and WEBP images are accepted',
    });
}
