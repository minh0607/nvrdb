import { logger } from '../config/logger.js';
import type { NvrDeviceRow, CameraInput } from '../models/schemas.js';

/**
 * HanwhaService wraps the Hanwha CGI API used by XRN-1620SB1 NVRs.
 *
 * CGI endpoints reference (Sunapi/Wisenet):
 *   - GET  /stw-cgi/system.cgi?msubmenu=deviceinfo&action=view
 *   - GET  /stw-cgi/media.cgi?msubmenu=channellist&action=view
 *   - GET  /stw-cgi/media.cgi?msubmenu=videoprofile&action=view&Channel=<n>
 *
 * RTSP LiveChannel/VideoClip indices are 0-based: UI channel N maps to
 * LiveChannel/(N-1) (UI channel 1 → LiveChannel/00, channel 16 → LiveChannel/15).
 *
 * RTSP URL pattern:
 *   rtsp://user:pass@ip:554/LiveChannel/<channel-1>/media.smp
 *
 * Playback RTSP pattern:
 *   rtsp://user:pass@ip:554/VideoClip/<channel-1>/<YYYYMMDD>/<HHMMSS>/<duration>
 */

// In-memory cache for camera lists per NVR, keyed by nvr id
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cameraListCache = new Map<number, CacheEntry<CameraInput[]>>();

function basicAuthHeader(username: string, password: string): string {
  const encoded = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${encoded}`;
}

export class HanwhaService {
  /**
   * Build the base HTTP URL for a Hanwha NVR CGI endpoint.
   */
  private static baseUrl(nvr: NvrDeviceRow): string {
    return `http://${nvr.ip}:${nvr.http_port}`;
  }

  /**
   * Make an authenticated CGI request to the NVR.
   */
  private static async cgiRequest(nvr: NvrDeviceRow, path: string): Promise<string> {
    const url = `${this.baseUrl(nvr)}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(url, {
        headers: { Authorization: basicAuthHeader(nvr.username, nvr.password) },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`CGI request failed: ${response.status} ${response.statusText}`);
      }

      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Check NVR connectivity by hitting the device info endpoint.
   * Returns 'online' | 'offline' | 'error'.
   */
  static async checkStatus(nvr: NvrDeviceRow): Promise<'online' | 'offline' | 'error'> {
    try {
      await this.cgiRequest(nvr, '/stw-cgi/system.cgi?msubmenu=deviceinfo&action=view');
      return 'online';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('abort') || message.includes('ECONNREFUSED')) {
        logger.warn({ nvrId: nvr.id, ip: nvr.ip }, 'NVR offline');
        return 'offline';
      }
      logger.error({ nvrId: nvr.id, ip: nvr.ip, error: message }, 'NVR connection error');
      return 'error';
    }
  }

  /**
   * Fetch the camera/channel list from the NVR via CGI.
   * Results are cached for 5 minutes.
   */
  static async listCameras(nvr: NvrDeviceRow): Promise<CameraInput[]> {
    const cached = cameraListCache.get(nvr.id);
    if (cached && cached.expiry > Date.now()) {
      logger.debug({ nvrId: nvr.id }, 'Returning cached camera list');
      return cached.data;
    }

    try {
      const raw = await this.cgiRequest(
        nvr,
        '/stw-cgi/media.cgi?msubmenu=channellist&action=view',
      );

      const cameras = this.parseCameraList(raw, nvr.max_channels);

      cameraListCache.set(nvr.id, {
        data: cameras,
        expiry: Date.now() + CACHE_TTL_MS,
      });

      return cameras;
    } catch (err) {
      logger.error({ nvrId: nvr.id, error: err }, 'Failed to list cameras from NVR');

      // Return fallback channel list based on max_channels
      return this.generateFallbackCameras(nvr.max_channels);
    }
  }

  /**
   * Parse the Hanwha CGI response into camera objects.
   * Hanwha CGI returns key=value pairs separated by newlines.
   *
   * Example response:
   *   Channel.0.Name=Camera 1
   *   Channel.0.Status=Connected
   *   Channel.0.Resolution=1920x1080
   *   Channel.1.Name=Camera 2
   *   ...
   */
  private static parseCameraList(raw: string, maxChannels: number): CameraInput[] {
    const cameras: CameraInput[] = [];
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);

    const channelData = new Map<number, Partial<CameraInput>>();

    for (const line of lines) {
      const match = line.match(/^Channel\.(\d+)\.(\w+)=(.+)$/);
      if (!match) continue;

      const channelIdx = parseInt(match[1], 10);
      const key = match[2];
      const value = match[3];

      if (!channelData.has(channelIdx)) {
        channelData.set(channelIdx, {});
      }
      const cam = channelData.get(channelIdx)!;

      switch (key) {
        case 'Name':
          cam.name = value;
          break;
        case 'Resolution':
          cam.resolution = value;
          break;
        case 'Codec':
          cam.codec = value;
          break;
        case 'FPS':
          cam.fps = parseInt(value, 10) || 30;
          break;
        case 'PTZ':
          cam.ptz_supported = value === '1' || value.toLowerCase() === 'true';
          break;
      }
    }

    for (const [idx, data] of channelData.entries()) {
      const channel = idx + 1; // Hanwha uses 0-indexed channels, we use 1-indexed
      if (channel > maxChannels) continue;

      cameras.push({
        channel,
        name: data.name ?? `Camera ${channel}`,
        resolution: data.resolution ?? '1920x1080',
        codec: data.codec ?? 'H.264',
        fps: data.fps ?? 30,
        enabled: true,
        ptz_supported: data.ptz_supported ?? false,
      });
    }

    return cameras;
  }

  /**
   * When CGI is unreachable, generate placeholder cameras so the UI
   * can still render a channel grid for the user to configure later.
   */
  static generateFallbackCameras(maxChannels: number): CameraInput[] {
    return Array.from({ length: maxChannels }, (_, i) => ({
      channel: i + 1,
      name: `Channel ${i + 1}`,
      resolution: '1920x1080',
      codec: 'H.264',
      fps: 30,
      enabled: true,
      ptz_supported: false,
    }));
  }

  /**
   * Build the live RTSP URL for a given NVR channel.
   * The LiveChannel index is 0-based, so UI channel N → LiveChannel/(N-1).
   */
  static buildRtspUrl(nvr: NvrDeviceRow, channel: number): string {
    const encodedUser = encodeURIComponent(nvr.username);
    const encodedPass = encodeURIComponent(nvr.password);
    // Append the Hanwha profile selector for the sub-stream when configured.
    // Default (unset) uses the channel's main profile (current behaviour).
    const profile = nvr.stream_profile ? `/profile=${nvr.stream_profile}` : '';
    return `rtsp://${encodedUser}:${encodedPass}@${nvr.ip}:${nvr.rtsp_port}/LiveChannel/${String(channel - 1).padStart(2, '0')}/media.smp${profile}`;
  }

  /**
   * Build the playback RTSP URL for a recorded clip.
   * date: YYYY-MM-DD, time: HH:MM, duration in seconds.
   * The VideoClip index is 0-based, so UI channel N → VideoClip/(N-1).
   */
  static buildPlaybackRtspUrl(
    nvr: NvrDeviceRow,
    channel: number,
    date: string,
    time: string,
    durationSec: number,
  ): string {
    const encodedUser = encodeURIComponent(nvr.username);
    const encodedPass = encodeURIComponent(nvr.password);
    const dateClean = date.replace(/-/g, '');
    const timeClean = time.replace(/:/g, '') + '00'; // append seconds
    return `rtsp://${encodedUser}:${encodedPass}@${nvr.ip}:${nvr.rtsp_port}/VideoClip/${String(channel - 1).padStart(2, '0')}/${dateClean}/${timeClean}/${durationSec}`;
  }

  /**
   * Invalidate the camera list cache for a specific NVR.
   */
  static invalidateCache(nvrId: number): void {
    cameraListCache.delete(nvrId);
  }

  /**
   * Clear the entire camera list cache.
   */
  static clearCache(): void {
    cameraListCache.clear();
  }
}
