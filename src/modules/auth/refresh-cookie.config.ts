import { CookieOptions } from 'express';

export const REFRESH_COOKIE_NAME = 'maryme_refresh';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export function parseDurationMs(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) throw new Error('JWT_REFRESH_EXPIRES_IN doit être une durée valide.');
  const units = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
  return Number(match[1]) * units[match[2] as keyof typeof units];
}

export function getRefreshCookieOptions(
  production: boolean,
  refreshExpiresIn: string,
): CookieOptions {
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? 'none' : 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: parseDurationMs(refreshExpiresIn),
  };
}

export function getClearRefreshCookieOptions(production: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? 'none' : 'lax',
    path: REFRESH_COOKIE_PATH,
  };
}
