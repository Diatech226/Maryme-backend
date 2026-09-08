import * as Joi from 'joi';
import { SUPER_ADMIN_PASSWORD_MIN_LENGTH } from '../modules/auth/password-policy.constants';

const internationalPhone = Joi.string()
  .trim()
  .pattern(/^(?:\+|00)[1-9][0-9 .()-]{6,20}$/);

export const superAdminEnvValidationSchema = Joi.object({
  SUPER_ADMIN_EMAIL: Joi.string()
    .trim()
    .lowercase()
    .email({ tlds: { allow: false } })
    .invalid('admin@admin.com')
    .required(),
  SUPER_ADMIN_PHONE: internationalPhone.required(),
  SUPER_ADMIN_PASSWORD: Joi.string().min(SUPER_ADMIN_PASSWORD_MIN_LENGTH).required(),
  SUPER_ADMIN_FIRST_NAME: Joi.string().trim().min(1).required(),
  SUPER_ADMIN_LAST_NAME: Joi.string().trim().min(1).required(),
}).unknown(true);

export interface SuperAdminEnvironment {
  SUPER_ADMIN_EMAIL: string;
  SUPER_ADMIN_PHONE: string;
  SUPER_ADMIN_PASSWORD: string;
  SUPER_ADMIN_FIRST_NAME: string;
  SUPER_ADMIN_LAST_NAME: string;
}

export function validateSuperAdminEnvironment(
  environment: NodeJS.ProcessEnv,
): SuperAdminEnvironment {
  const { error, value } = superAdminEnvValidationSchema.validate(environment, {
    abortEarly: false,
  });
  if (error) throw new Error(`Invalid SUPER_ADMIN configuration: ${error.message}`);
  return value as SuperAdminEnvironment;
}

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(4000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['mongodb', 'mongodb+srv'] })
    .required(),
  CORS_ORIGINS: Joi.string().required(),
  FRONTEND_URL: Joi.string().uri().required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),
  COOKIE_SECURE: Joi.boolean().default(false),
  ARGON2_MEMORY_COST: Joi.number().integer().min(8192).default(19456),
  STORAGE_DRIVER: Joi.string().valid('gridfs', 'local').default('gridfs'),
  GRIDFS_BUCKET: Joi.string().trim().min(1).default('maryme_storage'),
  STORAGE_LOCAL_DIR: Joi.string().when('STORAGE_DRIVER', {
    is: 'local',
    then: Joi.string().default('.storage'),
    otherwise: Joi.forbidden(),
  }),
  STORAGE_MAX_UPLOAD_BYTES: Joi.number()
    .integer()
    .positive()
    .default(10 * 1024 * 1024),
  PUBLIC_API_URL: Joi.string().uri().optional(),
  SHARE_LINK_MAX_DAYS: Joi.number().integer().positive().default(30),
  SUPER_ADMIN_EMAIL: Joi.string()
    .trim()
    .lowercase()
    .email({ tlds: { allow: false } })
    .invalid('admin@admin.com')
    .optional(),
  SUPER_ADMIN_PHONE: internationalPhone.optional(),
  SUPER_ADMIN_PASSWORD: Joi.string().min(SUPER_ADMIN_PASSWORD_MIN_LENGTH).optional(),
  SUPER_ADMIN_FIRST_NAME: Joi.string().trim().min(1).optional(),
  SUPER_ADMIN_LAST_NAME: Joi.string().trim().min(1).optional(),
});
