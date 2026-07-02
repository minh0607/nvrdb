import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const dbDir = path.dirname(path.resolve(env.DATABASE_PATH));
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db: Database.Database = new Database(path.resolve(env.DATABASE_PATH));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initializeDatabase(): void {
  logger.info('Initializing database schema...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS nvr_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ip TEXT NOT NULL,
      http_port INTEGER NOT NULL DEFAULT 80,
      rtsp_port INTEGER NOT NULL DEFAULT 554,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      model TEXT DEFAULT 'XRN-1620SB1',
      max_channels INTEGER DEFAULT 16,
      stream_profile INTEGER,
      status TEXT CHECK(status IN ('online', 'offline', 'error')) DEFAULT 'offline',
      last_checked_at TEXT,
      area_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE SET NULL,
      UNIQUE(ip, http_port)
    );

    CREATE TABLE IF NOT EXISTS cameras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nvr_id INTEGER NOT NULL,
      channel INTEGER NOT NULL,
      name TEXT NOT NULL,
      resolution TEXT DEFAULT '1920x1080',
      codec TEXT DEFAULT 'H.264',
      fps INTEGER DEFAULT 30,
      enabled INTEGER DEFAULT 1,
      ptz_supported INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (nvr_id) REFERENCES nvr_devices(id) ON DELETE CASCADE,
      UNIQUE(nvr_id, channel)
    );

    CREATE TABLE IF NOT EXISTS stream_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nvr_id INTEGER NOT NULL,
      camera_id INTEGER NOT NULL,
      stream_name TEXT NOT NULL UNIQUE,
      protocol TEXT CHECK(protocol IN ('webrtc', 'hls', 'mse')) DEFAULT 'webrtc',
      started_at TEXT DEFAULT (datetime('now')),
      last_active_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (nvr_id) REFERENCES nvr_devices(id) ON DELETE CASCADE,
      FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT CHECK(role IN ('admin', 'viewer')) DEFAULT 'viewer',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS layouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      image_path TEXT,
      image_mime TEXT,
      width INTEGER,
      height INTEGER,
      area_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS layout_placements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      layout_id INTEGER NOT NULL,
      nvr_id INTEGER NOT NULL,
      channel INTEGER NOT NULL,
      label TEXT,
      x REAL NOT NULL,
      y REAL NOT NULL,
      view_mode TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (layout_id) REFERENCES layouts(id) ON DELETE CASCADE,
      FOREIGN KEY (nvr_id) REFERENCES nvr_devices(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS allowed_ips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      label TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_cameras_nvr ON cameras(nvr_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_nvr ON stream_sessions(nvr_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_camera ON stream_sessions(camera_id);
    CREATE INDEX IF NOT EXISTS idx_placements_layout ON layout_placements(layout_id);
  `);

  // Seed the global default view mode if it isn't already set.
  db.prepare(
    "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('default_view_mode', 'go2rtc')",
  ).run();

  // Seed the VLC installer download URL (empty until an admin sets it).
  db.prepare(
    "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('vlc_download_url', '')",
  ).run();

  runMigrations();
  logger.info('Database schema initialized');
}

/**
 * Idempotent column migrations for DBs created before a column existed
 * (CREATE TABLE IF NOT EXISTS does not add columns to an existing table).
 */
function runMigrations(): void {
  const cols = db.prepare('PRAGMA table_info(nvr_devices)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'stream_profile')) {
    db.exec('ALTER TABLE nvr_devices ADD COLUMN stream_profile INTEGER');
    logger.info('Migration: added nvr_devices.stream_profile');
  }
  if (!cols.some((c) => c.name === 'area_id')) {
    db.exec(
      'ALTER TABLE nvr_devices ADD COLUMN area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL',
    );
    logger.info('Migration: added nvr_devices.area_id');
  }

  const cameraCols = db.prepare('PRAGMA table_info(cameras)').all() as Array<{ name: string }>;
  if (!cameraCols.some((c) => c.name === 'rtsp_override')) {
    db.exec('ALTER TABLE cameras ADD COLUMN rtsp_override TEXT');
    logger.info('Migration: added cameras.rtsp_override');
  }

  const placementCols = db
    .prepare('PRAGMA table_info(layout_placements)')
    .all() as Array<{ name: string }>;
  if (!placementCols.some((c) => c.name === 'view_mode')) {
    db.exec('ALTER TABLE layout_placements ADD COLUMN view_mode TEXT');
    logger.info('Migration: added layout_placements.view_mode');
  }

  const layoutCols = db.prepare('PRAGMA table_info(layouts)').all() as Array<{ name: string }>;
  if (!layoutCols.some((c) => c.name === 'width')) {
    db.exec('ALTER TABLE layouts ADD COLUMN width INTEGER');
    logger.info('Migration: added layouts.width');
  }
  if (!layoutCols.some((c) => c.name === 'height')) {
    db.exec('ALTER TABLE layouts ADD COLUMN height INTEGER');
    logger.info('Migration: added layouts.height');
  }
  if (!layoutCols.some((c) => c.name === 'area_id')) {
    db.exec(
      "ALTER TABLE layouts ADD COLUMN area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL",
    );
    logger.info('Migration: added layouts.area_id');
  }
}

export default db;
