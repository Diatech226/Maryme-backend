import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../../common/types/auth-user';
import { PrismaService } from '../../prisma/prisma.service';
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('auth.accessSecret'),
    });
  }
  async validate(payload: AuthUser): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { couple: true },
    });
    if (!user?.isActive)
      throw new UnauthorizedException({
        code: user?.role === UserRole.ACCESS_AGENT ? 'ACCESS_AGENT_INACTIVE' : 'ACCOUNT_INACTIVE',
        message: 'Ce compte est inactif.',
      });
    if (user.couple && user.couple.status !== 'AUTHORIZED')
      throw new UnauthorizedException('Couple is not authorized');
    return { sub: user.id, role: user.role, ...(user.coupleId ? { coupleId: user.coupleId } : {}) };
  }
}
