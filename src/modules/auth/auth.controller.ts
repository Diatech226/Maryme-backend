import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/types/auth-user';
import { AuthService, SessionResult } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  getClearRefreshCookieOptions,
  getRefreshCookieOptions,
  REFRESH_COOKIE_NAME,
} from './refresh-cookie.config';

type CookieRequest = Request & { cookies?: Record<string, string> };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private get production(): boolean {
    return this.config.get<boolean>('app.production', false);
  }

  private send(result: SessionResult, response: Response): Omit<SessionResult, 'refreshToken'> {
    response.cookie(
      REFRESH_COOKIE_NAME,
      result.refreshToken,
      getRefreshCookieOptions(
        this.production,
        this.config.get<string>('auth.refreshExpiresIn', '30d'),
      ),
    );
    const { refreshToken: _refreshToken, ...body } = result;
    return body;
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.send(await this.auth.login(dto, req.ip, req.get('user-agent')), res);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(200)
  async refresh(@Req() req: CookieRequest, @Res({ passthrough: true }) res: Response) {
    return this.send(
      await this.auth.refresh(req.cookies?.[REFRESH_COOKIE_NAME], req.ip, req.get('user-agent')),
      res,
    );
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: CookieRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE_NAME]);
    res.clearCookie(REFRESH_COOKIE_NAME, getClearRefreshCookieOptions(this.production));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.sub);
  }
}
