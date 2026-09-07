import { BadRequestException } from '@nestjs/common';
import { validateUpload } from './upload-validation';
const file = (buffer: Buffer, mimetype: string, originalname: string) => ({
  buffer,
  mimetype,
  originalname,
  size: buffer.length,
});
describe('validateUpload', () => {
  it('accepts a PNG with matching magic bytes and extension', () =>
    expect(() =>
      validateUpload(
        file(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png', 'ignored.png'),
        1024,
      ),
    ).not.toThrow());
  it('rejects SVG even when declared as an image', () =>
    expect(() =>
      validateUpload(file(Buffer.from('<svg/>'), 'image/svg+xml', 'x.svg'), 1024),
    ).toThrow(BadRequestException));
  it('rejects forged MIME types', () =>
    expect(() =>
      validateUpload(file(Buffer.from('not pdf'), 'application/pdf', 'x.pdf'), 1024),
    ).toThrow(BadRequestException));
  it('rejects oversized content', () =>
    expect(() =>
      validateUpload(file(Buffer.from([0xff, 0xd8, 0xff, 0, 0]), 'image/jpeg', 'x.jpg'), 4),
    ).toThrow(BadRequestException));
});
