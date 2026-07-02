import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';

import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { initializeDatabase } from './models/database.js';
import { AuthService } from './services/auth.service.js';
import { NvrService } from './services/nvr.service.js';
import { errorHandler } from './middleware/error.middleware.js';
import { ipAllowlist } from './middleware/ip-allowlist.middleware.js';

import authRoutes from './routes/auth.routes.js';
import nvrRoutes from './routes/nvr.routes.js';
import streamRoutes from './routes/stream.routes.js';
import layoutRoutes from './routes/layout.routes.js';
import areaRoutes from './routes/area.routes.js';
import publicRoutes from './routes/public.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import allowedIpRoutes from './routes/allowed-ip.routes.js';

// App version (read from package.json) so the running server can self-report it.
function readAppVersion(): string {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8');
    return (JSON.parse(raw).version as string) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
const APP_VERSION = readAppVersion();

async function bootstrap(): Promise<void> {
  // ── Database ────────────────────────────────────────────
  initializeDatabase();
  await AuthService.ensureAdminExists();

  // ── Express App ─────────────────────────────────────────
  const app = express();

  // Security headers. CSP is disabled because the SPA connects cross-origin to
  // the go2rtc media server (WebRTC signaling + blob/mediastream playback) and
  // a default CSP silently breaks that. Acceptable for the airgapped LAN target
  // where external injection/exfil is not a threat; all other Helmet headers stay.
  app.use(helmet({ contentSecurityPolicy: false }));

  // ── IP Allowlist (global gate) ──────────────────────────
  // Applied FIRST — before CORS, body parsing, and any route mount or the static
  // SPA handler — so a blocked IP gets 403 for both /api and the frontend without
  // any prior processing. Loopback is always allowed, so the server-local admin
  // is never locked out. Empty allowlist = open by default.
  app.use(ipAllowlist);

  // CORS
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    }),
  );

  // Body parsing
  app.use(express.json({ limit: '1mb' }));

  // Rate limiting
  app.use(
    '/api/auth',
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 20, // 20 login attempts per window
      message: { success: false, data: null, error: 'Too many login attempts' },
    }),
  );

  // Tighter limiter for the unauthenticated public namespace. Mounted BEFORE the
  // general /api limiter so public traffic hits this stricter budget first.
  app.use(
    '/api/public',
    rateLimit({
      windowMs: 60_000,
      max: 30,
      message: { success: false, data: null, error: 'Rate limit exceeded' },
    }),
  );

  app.use(
    '/api',
    rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 300, // 300 requests per minute
      message: { success: false, data: null, error: 'Rate limit exceeded' },
    }),
  );

  // ── Routes ──────────────────────────────────────────────
  app.use('/api/auth', authRoutes);
  app.use('/api/nvr', nvrRoutes);
  app.use('/api/streams', streamRoutes);
  app.use('/api/layouts', layoutRoutes);
  app.use('/api/areas', areaRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/allowed-ips', allowedIpRoutes);

  // Health check (no auth required)
  app.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      data: {
        status: 'ok',
        version: APP_VERSION,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      },
      error: null,
    });
  });

  // ── Static Frontend (production single-process serving) ──
  // When FRONTEND_DIST is set, serve the built SPA same-origin with the API.
  // SPA fallback returns index.html for non-/api GET routes (client routing).
  if (env.FRONTEND_DIST) {
    const distPath = path.resolve(env.FRONTEND_DIST);
    const indexHtml = path.join(distPath, 'index.html');
    if (fs.existsSync(indexHtml)) {
      app.use(express.static(distPath));
      app.use((req, res, next) => {
        if (req.method === 'GET' && !req.path.startsWith('/api')) {
          res.sendFile(indexHtml);
          return;
        }
        next();
      });
      logger.info(`Serving frontend from ${distPath}`);
    } else {
      logger.warn(`FRONTEND_DIST set but index.html not found at ${distPath}`);
    }
  }

  // ── Error Handler ───────────────────────────────────────
  app.use(errorHandler);

  // ── Start Server ────────────────────────────────────────
  app.listen(env.PORT, () => {
    logger.info(`NVR Dashboard API v${APP_VERSION} running on port ${env.PORT}`);
    logger.info(`Environment: ${env.NODE_ENV}`);
    logger.info(`go2rtc endpoint: ${env.GO2RTC_API_URL}`);
  });

  // ── Periodic NVR Health Checks ──────────────────────────
  const STATUS_CHECK_INTERVAL_MS = 60_000; // every 60 seconds
  setInterval(() => {
    NvrService.checkAllStatuses().catch((err) => {
      logger.error({ error: err }, 'Periodic status check failed');
    });
  }, STATUS_CHECK_INTERVAL_MS);
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
