import { registerAs } from '@nestjs/config';
export default registerAs('app', () => ({ port: Number(process.env.PORT ?? 4000), origins: (process.env.CORS_ORIGINS ?? '').split(',').map((v) => v.trim()).filter(Boolean), production: process.env.NODE_ENV === 'production', frontendUrl: process.env.FRONTEND_URL }));
