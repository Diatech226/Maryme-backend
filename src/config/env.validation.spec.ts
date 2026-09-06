import { envValidationSchema, validateSuperAdminEnvironment } from './env.validation';

describe('DATABASE_URL validation', () => {
  const environment = {
    NODE_ENV: 'test',
    CORS_ORIGINS: 'http://localhost:3000',
    FRONTEND_URL: 'http://localhost:3000',
    JWT_ACCESS_SECRET: 'access-secret-with-at-least-32-characters',
    JWT_REFRESH_SECRET: 'refresh-secret-with-at-least-32-characters',
  };

  it.each([
    'mongodb://localhost:27017/maryme',
    'mongodb+srv://user:password@cluster.example/maryme',
  ])('accepts MongoDB URI %s', (DATABASE_URL) => {
    expect(envValidationSchema.validate({ ...environment, DATABASE_URL }).error).toBeUndefined();
  });

  it.each(['postgresql://localhost:5432/maryme', 'postgres://localhost:5432/maryme'])(
    'rejects non-MongoDB URI %s',
    (DATABASE_URL) => {
      expect(envValidationSchema.validate({ ...environment, DATABASE_URL }).error).toBeDefined();
    },
  );
});

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

  it('accepts a SUPER_ADMIN password of exactly eight characters', () => {
    expect(() =>
      validateSuperAdminEnvironment({
        ...valid,
        SUPER_ADMIN_PASSWORD: 'Abcd1234',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('rejects passwords shorter than eight characters and local phone numbers', () => {
    expect(() =>
      validateSuperAdminEnvironment({
        ...valid,
        SUPER_ADMIN_PASSWORD: '1234567',
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
