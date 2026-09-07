import {
  getClearRefreshCookieOptions,
  getRefreshCookieOptions,
  parseDurationMs,
  REFRESH_COOKIE_PATH,
} from './refresh-cookie.config';

describe('refresh cookie configuration', () => {
  it('uses a secure cross-site cookie in production', () => {
    expect(getRefreshCookieOptions(true, '30d')).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: REFRESH_COOKIE_PATH,
      maxAge: 30 * 86_400_000,
    });
    expect(getClearRefreshCookieOptions(true)).toMatchObject({
      secure: true,
      sameSite: 'none',
      path: REFRESH_COOKIE_PATH,
    });
  });

  it('uses a non-secure same-site cookie locally and parses configured durations', () => {
    expect(getRefreshCookieOptions(false, '12h')).toMatchObject({
      secure: false,
      sameSite: 'lax',
      maxAge: 12 * 3_600_000,
    });
    expect(parseDurationMs('15m')).toBe(900_000);
    expect(() => parseDurationMs('forever')).toThrow('durée valide');
  });
});
