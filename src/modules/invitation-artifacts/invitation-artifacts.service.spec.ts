import { UserRole } from '@prisma/client';
import { InvitationArtifactsService } from './invitation-artifacts.service';

describe('InvitationArtifactsService shared design', () => {
  it('creates separate guest artifacts from one reusable design', async () => {
    const user = { sub: 'user-1', role: UserRole.COUPLE, coupleId: 'couple-1' };
    const now = new Date();
    const artifacts: Array<Record<string, unknown>> = [];
    const prisma = {
      invitation: {
        findUnique: jest.fn(({ where }) =>
          Promise.resolve({
            id: where.id,
            coupleId: 'couple-1',
            guestId: where.id === 'invitation-1' ? 'guest-1' : 'guest-2',
            guest: { updatedAt: now },
            couple: { updatedAt: now },
          }),
        ),
      },
      invitationDesign: {
        findFirst: jest.fn().mockResolvedValue({ id: 'design-1', updatedAt: now }),
      },
      invitationArtifact: {
        create: jest.fn(({ data }) => {
          const artifact = { id: `artifact-${artifacts.length + 1}`, generatedAt: now, ...data };
          artifacts.push(artifact);
          return Promise.resolve(artifact);
        }),
      },
    };
    const storage = { put: jest.fn(), delete: jest.fn() };
    const service = new InvitationArtifactsService(
      prisma as never,
      storage as never,
      { record: jest.fn() } as never,
      { get: jest.fn().mockReturnValue(1024) } as never,
    );
    const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const image = {
      buffer: imageBuffer,
      mimetype: 'image/png',
      originalname: 'card.png',
      size: imageBuffer.length,
    };

    const first = await service.create('invitation-1', 'design-1', image, undefined, user);
    const second = await service.create('invitation-2', 'design-1', image, undefined, user);

    expect(first.id).not.toBe(second.id);
    expect(first.guestId).not.toBe(second.guestId);
    expect(first.invitationId).not.toBe(second.invitationId);
    expect(first.designId).toBe('design-1');
    expect(second.designId).toBe('design-1');
    expect(storage.put).toHaveBeenCalledTimes(2);
    expect(artifacts).toHaveLength(2);
  });
});
