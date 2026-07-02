import db from '../models/database.js';
import { logger } from '../config/logger.js';

/**
 * SettingsService is a thin key/value store over the `app_settings` table.
 * Used for non-sensitive global configuration such as the default view mode.
 */
export class SettingsService {
  static get(key: string): string | undefined {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  static set(key: string, value: string): void {
    db.prepare(`
      INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
    logger.info({ key }, 'App setting updated');
  }

  /**
   * Global default view mode for cameras that don't set a per-camera override.
   * Falls back to 'go2rtc' when unset or holding an unexpected value.
   */
  static getDefaultViewMode(): 'go2rtc' | 'vlc' {
    return this.get('default_view_mode') === 'vlc' ? 'vlc' : 'go2rtc';
  }

  /**
   * URL to the VLC installer used by the downloadable setup script. Empty string
   * when unset; the generated script substitutes a placeholder in that case.
   */
  static getVlcDownloadUrl(): string {
    return this.get('vlc_download_url') ?? '';
  }

  static setVlcDownloadUrl(url: string): void {
    this.set('vlc_download_url', url);
  }
}
