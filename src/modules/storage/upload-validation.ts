import { BadRequestException } from '@nestjs/common';
import { extname } from 'path';
export interface UploadFile {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
}
const signatures: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) =>
    b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
  'application/pdf': (b) => b.subarray(0, 5).toString() === '%PDF-',
};
const extensions: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
};
export function validateUpload(
  file: UploadFile | undefined,
  maxBytes: number,
  allowed = Object.keys(signatures),
): asserts file is UploadFile {
  if (!file) throw new BadRequestException('File is required');
  const mime = file.mimetype.toLowerCase();
  if (!allowed.includes(mime) || !signatures[mime]?.(file.buffer))
    throw new BadRequestException('Unsupported or invalid file content');
  if (!extensions[mime].includes(extname(file.originalname).toLowerCase()))
    throw new BadRequestException('File extension does not match its content');
  if (file.size > maxBytes) throw new BadRequestException('File is too large');
}
