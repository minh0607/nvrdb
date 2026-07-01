import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Go2rtcService manages the go2rtc media proxy.
 *
 * go2rtc API reference (v1.9+) — verified against go2rtc 1.9.14:
 *   GET    /api/streams              - list all streams
 *   PUT    /api/streams?name=X&src=Y - add stream (source in `src` QUERY param;
 *                                      a JSON body is silently ignored)
 *   DELETE /api/streams?src=X        - remove stream (identified by `src`, NOT `name`)
 *   POST   /api/webrtc?src=X         - start WebRTC session (SDP offer/answer)
 *   GET    /api/stream.m3u8?src=X    - HLS playlist
 *
 * Stream naming convention:
 *   nvr_{nvrId}_ch{channel}     for live streams
 *   nvr_{nvrId}_ch{channel}_pb  for playback streams
 *
 * SECURITY: go2rtc's API has no per-endpoint auth and supports `exec:` sources
 * (arbitrary process spawn). It MUST NOT be exposed to untrusted networks — bind
 * it to loopback and front it with an authenticated reverse proxy that blocks
 * PUT/DELETE management paths. See docs/RUNNING.md. If go2rtc Basic auth is
 * enabled, set GO2RTC_USERNAME/GO2RTC_PASSWORD so backend calls authenticate.
 */

interface Go2rtcStream {
  name: string;
  producers: Array<{ url: string }>;
  consumers: number;
}

// All backend→go2rtc calls are bounded so a slow/hung go2rtc can't stall
// request handlers indefinitely (addStream runs on every live-view request).
const GO2RTC_TIMEOUT_MS = 5000;

export class Go2rtcService {
  private static readonly baseUrl = env.GO2RTC_API_URL;

  // Dedupe cache for addStream: maps stream name → {url, ts}. A repeat request
  // for the same name+url within DEDUPE_WINDOW_MS skips the redundant PUT. A
  // different url is never skipped, so an edited override re-registers.
  private static readonly streamRegisteredAt = new Map<string, { url: string; ts: number }>();
  private static readonly DEDUPE_WINDOW_MS = 60_000;

  /**
   * Authorization header for backend→go2rtc calls when go2rtc Basic auth is on.
   * Returns an empty object when no credentials are configured (default).
   */
  private static authHeaders(): Record<string, string> {
    if (!env.GO2RTC_USERNAME) return {};
    const token = Buffer.from(`${env.GO2RTC_USERNAME}:${env.GO2RTC_PASSWORD}`).toString(
      'base64',
    );
    return { Authorization: `Basic ${token}` };
  }

  /**
   * Build the canonical stream name for a live channel.
   */
  static streamName(nvrId: number, channel: number): string {
    return `nvr_${nvrId}_ch${channel}`;
  }

  /**
   * Build the canonical stream name for a playback session.
   */
  static playbackStreamName(nvrId: number, channel: number): string {
    return `nvr_${nvrId}_ch${channel}_pb`;
  }

  /**
   * Register a new RTSP source stream with go2rtc.
   * If the stream already exists, it will be replaced.
   */
  static async addStream(name: string, rtspUrl: string): Promise<boolean> {
    // Skip the redundant PUT if we registered this exact name+url very recently.
    const cached = this.streamRegisteredAt.get(name);
    if (cached && cached.url === rtspUrl && Date.now() - cached.ts < this.DEDUPE_WINDOW_MS) {
      return true;
    }
    try {
      // go2rtc's PUT /api/streams expects the source in the `src` query param,
      // not a JSON body. A JSON body is silently ignored (returns 200 but creates
      // no stream), so the `src` param is required for the stream to actually exist.
      const url =
        `${this.baseUrl}/api/streams` +
        `?name=${encodeURIComponent(name)}&src=${encodeURIComponent(rtspUrl)}`;
      const response = await fetch(url, {
        method: 'PUT',
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(GO2RTC_TIMEOUT_MS),
      });

      if (!response.ok) {
        logger.error(
          { name, status: response.status },
          'Failed to add stream to go2rtc',
        );
        return false;
      }

      this.streamRegisteredAt.set(name, { url: rtspUrl, ts: Date.now() });
      logger.info({ name }, 'Stream added to go2rtc');
      return true;
    } catch (err) {
      logger.error({ name, error: err }, 'go2rtc addStream error');
      return false;
    }
  }

  /**
   * Remove a stream from go2rtc.
   */
  static async removeStream(name: string): Promise<boolean> {
    try {
      // go2rtc's DELETE /api/streams identifies the stream via the `src` param.
      // Using `name` returns 200 but deletes nothing, leaking streams over time.
      const url = `${this.baseUrl}/api/streams?src=${encodeURIComponent(name)}`;
      const response = await fetch(url, {
        method: 'DELETE',
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(GO2RTC_TIMEOUT_MS),
      });

      if (!response.ok && response.status !== 404) {
        logger.error({ name, status: response.status }, 'Failed to remove stream');
        return false;
      }

      logger.info({ name }, 'Stream removed from go2rtc');
      return true;
    } catch (err) {
      logger.error({ name, error: err }, 'go2rtc removeStream error');
      return false;
    }
  }

  /**
   * List all active streams in go2rtc.
   */
  static async listStreams(): Promise<Record<string, Go2rtcStream>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/streams`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(GO2RTC_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Status ${response.status}`);
      }
      const data: unknown = await response.json();
      if (typeof data !== 'object' || data === null) {
        logger.warn('go2rtc /api/streams returned unexpected shape');
        return {};
      }
      return data as Record<string, Go2rtcStream>;
    } catch (err) {
      logger.error({ error: err }, 'Failed to list go2rtc streams');
      return {};
    }
  }

  /**
   * Get the WebRTC endpoint URL for a stream.
   * The frontend uses this to establish a peer connection.
   */
  static getWebRtcUrl(streamName: string): string {
    return `${this.baseUrl}/api/webrtc?src=${encodeURIComponent(streamName)}`;
  }

  /**
   * Get the HLS playlist URL for a stream.
   * Used as fallback when WebRTC is unavailable.
   */
  static getHlsUrl(streamName: string): string {
    return `${this.baseUrl}/api/stream.m3u8?src=${encodeURIComponent(streamName)}`;
  }

  /**
   * Get the MSE (Media Source Extensions) URL for a stream.
   * Used as an alternative to HLS for lower latency in supported browsers.
   */
  static getMseUrl(streamName: string): string {
    return `${this.baseUrl}/api/ws?src=${encodeURIComponent(streamName)}`;
  }

  /**
   * Check go2rtc health/availability.
   */
  static async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/streams`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Register all cameras for an NVR at once.
   * Returns count of successfully added streams.
   */
  static async registerNvrStreams(
    nvrId: number,
    rtspUrls: Array<{ channel: number; url: string }>,
  ): Promise<number> {
    let successCount = 0;

    // Process in series to avoid overwhelming go2rtc
    for (const { channel, url } of rtspUrls) {
      const name = this.streamName(nvrId, channel);
      const ok = await this.addStream(name, url);
      if (ok) successCount++;
    }

    logger.info(
      { nvrId, total: rtspUrls.length, registered: successCount },
      'NVR streams registered with go2rtc',
    );

    return successCount;
  }

  /**
   * Remove all streams for an NVR.
   */
  static async unregisterNvrStreams(nvrId: number): Promise<void> {
    const streams = await this.listStreams();
    const prefix = `nvr_${nvrId}_`;
    for (const [name, info] of Object.entries(streams)) {
      if (!name.startsWith(prefix)) continue;
      this.streamRegisteredAt.delete(name);
      // go2rtc DELETE identifies a stream by its producer `src` URL, not by name.
      for (const producer of info.producers ?? []) {
        try {
          await fetch(
            `${this.baseUrl}/api/streams?src=${encodeURIComponent(producer.url)}`,
            { method: 'DELETE', headers: this.authHeaders(), signal: AbortSignal.timeout(GO2RTC_TIMEOUT_MS) },
          );
        } catch (err) {
          logger.error({ name, error: err }, 'go2rtc unregister error');
        }
      }
    }
  }
}
