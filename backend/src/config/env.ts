import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRY: z.string().default('24h'),
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().min(8, 'ADMIN_PASSWORD must be at least 8 characters'),
  GO2RTC_HOST: z.string().default('localhost'),
  GO2RTC_PORT: z.coerce.number().default(1984),
  GO2RTC_API_URL: z.string().url().default('http://localhost:1984'),
  // Backend→go2rtc management URL. Defaults to loopback (same host as the backend)
  // so it never rides the flaky LAN-IP/firewall path. Browser URLs use GO2RTC_API_URL.
  GO2RTC_INTERNAL_URL: z.string().url().default('http://127.0.0.1:1984'),
  // Optional: set when go2rtc Basic auth is enabled so backend calls authenticate.
  GO2RTC_USERNAME: z.string().default(''),
  GO2RTC_PASSWORD: z.string().default(''),
  DATABASE_PATH: z.string().default('./data/nvr-dashboard.db'),
  // When set, the backend also serves the built frontend (SPA) from this dir,
  // so production runs a single process and the app is same-origin with /api.
  FRONTEND_DIST: z.string().default(''),
  NVR_DEFAULT_RTSP_PORT: z.coerce.number().default(554),
  NVR_DEFAULT_HTTP_PORT: z.coerce.number().default(80),
  NVR_MAX_CONCURRENT_STREAMS: z.coerce.number().default(10),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Environment validation failed:');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
