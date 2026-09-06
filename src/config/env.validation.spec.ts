import { validateSuperAdminEnvironment } from './env.validation';

describe('SUPER_ADMIN environment validation', () => {
  const valid = {
    SUPER_ADMIN_EMAIL: 'Admin.Bootstrap@Maryme.Test',
    SUPER_ADMIN_PHONE: '+22670000001',
    SUPER_ADMIN_PASSWORD: 'AdminBootstrapPassword123!',
    SUPER_ADMIN_FIRST_NAME: 'Admin',
    SUPER_ADMIN_LAST_NAME: 'Test',
  };

  it('requires every bootstrap value and normalizes the email', () => {
    expect(validateSuperAdminEnvironment(valid as NodeJS.ProcessEnv).SUPER_ADMIN_EMAIL).toBe(
      'admin.bootstrap@maryme.test',
    );
    expect(() =>
      validateSuperAdminEnvironment({
        ...valid,
        SUPER_ADMIN_PHONE: undefined,
      } as NodeJS.ProcessEnv),
    ).toThrow('SUPER_ADMIN_PHONE');
  });

  it('rejects weak credentials and local phone numbers', () => {
    expect(() =>
      validateSuperAdminEnvironment({
        ...valid,
        SUPER_ADMIN_PASSWORD: 'password',
      } as NodeJS.ProcessEnv),
    ).toThrow('SUPER_ADMIN_PASSWORD');
    expect(() =>
      validateSuperAdminEnvironment({
        ...valid,
        SUPER_ADMIN_PHONE: '70 00 00 00',
      } as NodeJS.ProcessEnv),
    ).toThrow('SUPER_ADMIN_PHONE');
  });
});
