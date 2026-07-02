import db from '../models/database.js';
import { logger } from '../config/logger.js';
import { HanwhaService } from './hanwha.service.js';
import { Go2rtcService } from './go2rtc.service.js';
import type {
  NvrDeviceRow,
  CameraRow,
  CreateNvrInput,
  UpdateNvrInput,
  UpdateCameraInput,
} from '../models/schemas.js';

/**
 * NvrService orchestrates NVR device CRUD, camera sync, and stream registration.
 */
export class NvrService {
  // ── NVR CRUD ──────────────────────────────────────────────

  static findAll(): NvrDeviceRow[] {
    return db.prepare('SELECT * FROM nvr_devices ORDER BY name').all() as NvrDeviceRow[];
  }

  static findById(id: number): NvrDeviceRow | undefined {
    return db.prepare('SELECT * FROM nvr_devices WHERE id = ?').get(id) as
      | NvrDeviceRow
      | undefined;
  }

  static create(input: CreateNvrInput): NvrDeviceRow {
    const stmt = db.prepare(`
      INSERT INTO nvr_devices (name, ip, http_port, rtsp_port, username, password, model, max_channels, stream_profile, area_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      input.name,
      input.ip,
      input.http_port,
      input.rtsp_port,
      input.username,
      input.password,
      input.model,
      input.max_channels,
      input.stream_profile ?? null,
      input.area_id ?? null,
    );

    const nvr = this.findById(result.lastInsertRowid as number)!;
    logger.info({ nvrId: nvr.id, name: nvr.name }, 'NVR device created');
    return nvr;
  }

  static update(id: number, input: UpdateNvrInput): NvrDeviceRow | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const merged = { ...existing, ...input, updated_at: new Date().toISOString() };

    db.prepare(`
      UPDATE nvr_devices
      SET name = ?, ip = ?, http_port = ?, rtsp_port = ?, username = ?,
          password = ?, model = ?, max_channels = ?, stream_profile = ?, area_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      merged.name,
      merged.ip,
      merged.http_port,
      merged.rtsp_port,
      merged.username,
      merged.password,
      merged.model,
      merged.max_channels,
      merged.stream_profile ?? null,
      merged.area_id ?? null,
      merged.updated_at,
      id,
    );

    HanwhaService.invalidateCache(id);
    logger.info({ nvrId: id }, 'NVR device updated');
    return this.findById(id)!;
  }

  static delete(id: number): boolean {
    const existing = this.findById(id);
    if (!existing) return false;

    // Clean up go2rtc streams before deleting
    Go2rtcService.unregisterNvrStreams(id).catch((err) => {
      logger.error({ nvrId: id, error: err }, 'Failed to unregister streams on delete');
    });

    db.prepare('DELETE FROM nvr_devices WHERE id = ?').run(id);
    HanwhaService.invalidateCache(id);
    logger.info({ nvrId: id }, 'NVR device deleted');
    return true;
  }

  // ── Camera Operations ─────────────────────────────────────

  static getCameras(nvrId: number): CameraRow[] {
    return db
      .prepare('SELECT * FROM cameras WHERE nvr_id = ? ORDER BY channel')
      .all(nvrId) as CameraRow[];
  }

  static getCamera(nvrId: number, channel: number): CameraRow | undefined {
    return db
      .prepare('SELECT * FROM cameras WHERE nvr_id = ? AND channel = ?')
      .get(nvrId, channel) as CameraRow | undefined;
  }

  /**
   * Update admin-editable fields (name/enabled/rtsp_override) for one camera.
   * Returns the updated row, or null if the camera does not exist.
   */
  static updateCamera(
    nvrId: number,
    channel: number,
    input: UpdateCameraInput,
  ): CameraRow | null {
    const existing = this.getCamera(nvrId, channel);
    if (!existing) return null;

    const name = input.name ?? existing.name;
    const enabled = input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled;
    const rtspOverride =
      input.rtsp_override !== undefined ? input.rtsp_override : existing.rtsp_override;

    db.prepare(`
      UPDATE cameras
      SET name = ?, enabled = ?, rtsp_override = ?, updated_at = datetime('now')
      WHERE nvr_id = ? AND channel = ?
    `).run(name, enabled, rtspOverride, nvrId, channel);

    logger.info({ nvrId, channel }, 'Camera updated');
    return this.getCamera(nvrId, channel)!;
  }

  /**
   * Resolve the RTSP source URL for a channel. A non-empty per-camera
   * rtsp_override takes precedence; otherwise the Hanwha URL is derived.
   */
  static resolveRtspUrl(nvr: NvrDeviceRow, channel: number): string {
    const camera = this.getCamera(nvr.id, channel);
    if (camera && typeof camera.rtsp_override === 'string' && camera.rtsp_override.trim() !== '') {
      const override = camera.rtsp_override.trim();
      // Defense-in-depth: only honor an rtsp/rtsps override. Anything else (e.g.
      // go2rtc exec:/pipe: sources) is rejected and we fall back to the derived
      // Hanwha URL, so a bad/legacy DB value can't inject a dangerous source.
      if (/^rtsps?:\/\//i.test(override)) {
        return override;
      }
      logger.warn(
        { nvrId: nvr.id, channel },
        'Ignoring non-rtsp rtsp_override; falling back to derived Hanwha URL',
      );
    }
    return HanwhaService.buildRtspUrl(nvr, channel);
  }

  /**
   * Discover cameras from the NVR via CGI and sync into the database.
   * If CGI is unreachable, generates placeholder cameras.
   */
  static async syncCameras(nvrId: number): Promise<CameraRow[]> {
    const nvr = this.findById(nvrId);
    if (!nvr) throw new Error(`NVR ${nvrId} not found`);

    const discovered = await HanwhaService.listCameras(nvr);

    const upsert = db.prepare(`
      INSERT INTO cameras (nvr_id, channel, name, resolution, codec, fps, enabled, ptz_supported)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(nvr_id, channel) DO UPDATE SET
        name = excluded.name,
        resolution = excluded.resolution,
        codec = excluded.codec,
        fps = excluded.fps,
        ptz_supported = excluded.ptz_supported,
        updated_at = datetime('now')
    `);

    const transaction = db.transaction(() => {
      for (const cam of discovered) {
        upsert.run(
          nvrId,
          cam.channel,
          cam.name,
          cam.resolution,
          cam.codec,
          cam.fps,
          cam.enabled ? 1 : 0,
          cam.ptz_supported ? 1 : 0,
        );
      }
    });

    transaction();
    logger.info({ nvrId, count: discovered.length }, 'Cameras synced');

    return this.getCameras(nvrId);
  }

  // ── Status Check ──────────────────────────────────────────

  /**
   * Check the status of an NVR and update the database record.
   */
  static async checkAndUpdateStatus(nvrId: number): Promise<'online' | 'offline' | 'error'> {
    const nvr = this.findById(nvrId);
    if (!nvr) throw new Error(`NVR ${nvrId} not found`);

    const status = await HanwhaService.checkStatus(nvr);

    db.prepare(`
      UPDATE nvr_devices SET status = ?, last_checked_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(status, nvrId);

    return status;
  }

  /**
   * Check status of all NVRs. Used by periodic health-check.
   */
  static async checkAllStatuses(): Promise<void> {
    const nvrs = this.findAll();
    for (const nvr of nvrs) {
      try {
        await this.checkAndUpdateStatus(nvr.id);
      } catch (err) {
        logger.error({ nvrId: nvr.id, error: err }, 'Status check failed');
      }
    }
  }

  // ── Stream Registration ───────────────────────────────────

  /**
   * Register all enabled cameras for an NVR with go2rtc.
   */
  static async registerStreams(nvrId: number): Promise<number> {
    const nvr = this.findById(nvrId);
    if (!nvr) throw new Error(`NVR ${nvrId} not found`);

    const cameras = this.getCameras(nvrId);
    const enabledCameras = cameras.filter((c) => c.enabled);

    const rtspUrls = enabledCameras.map((cam) => ({
      channel: cam.channel,
      url: this.resolveRtspUrl(nvr, cam.channel),
    }));

    return Go2rtcService.registerNvrStreams(nvrId, rtspUrls);
  }
}
