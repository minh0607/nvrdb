import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import { api } from '../../lib/api';
import { Loader2 } from 'lucide-react';

interface HlsTileProps {
  nvrId: number;
  channel: number;
  name: string;
}

// ── Connect concurrency gate ────────────────────────────────────────────────
// A 3x3 grid mounts 9 tiles at once, and each tile makes go2rtc pull an RTSP
// stream from the NVR. Firing 9 simultaneous RTSP DESCRIBE setups overloads the
// Hanwha NVR (it only services a few concurrent session setups), so the excess
// fail with "wrong response on DESCRIBE". Limit how many tiles are in the
// *connecting* phase at once; a slot frees as soon as a tile starts playing (or
// fails), letting the next tile start. A safety timer releases a stuck slot so
// the gate can never deadlock.
const MAX_CONCURRENT_HLS_CONNECTS = 2;
// Safety-timer backstop only — the slot normally frees on FRAG_BUFFERED /
// 'playing' / fatal error. Must be LONGER than a slow cold start (go2rtc RTSP
// pull + first keyframe + first HLS segment can exceed 15s on a loaded NVR):
// at 9s the timer fired mid-setup and let extra tiles pile their RTSP DESCRIBEs
// onto the NVR, which then rejected a random few (grid came up with 6-8 of 9).
const CONNECT_SLOT_TIMEOUT_MS = 20_000;
let activeConnects = 0;
const connectQueue: Array<() => void> = [];

function acquireConnectSlot(): Promise<void> {
  if (activeConnects < MAX_CONCURRENT_HLS_CONNECTS) {
    activeConnects++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => connectQueue.push(resolve));
}

function releaseConnectSlot(): void {
  const next = connectQueue.shift();
  if (next) next(); // hand the slot directly to the next waiter (count unchanged)
  else activeConnects = Math.max(0, activeConnects - 1);
}

// Backoff (ms) before re-fetching the stream URL and rebuilding the player after
// a hard failure. A retry re-enters the connect gate, so keep this comfortably
// above the setup churn to avoid slamming the NVR again immediately. Jitter
// desynchronizes tiles that failed together, so their forced go2rtc drop+re-pull
// cycles don't hit the NVR as one synchronized burst every retry round.
const RETRY_DELAY_MS = 10000;
const RETRY_JITTER_MS = 5000;

function retryDelayWithJitter(): number {
  return RETRY_DELAY_MS + Math.random() * RETRY_JITTER_MS;
}
// Consecutive network errors tolerated via startLoad() before a full teardown.
const MAX_NETWORK_RECOVERS = 3;

type TileStatus = 'connecting' | 'playing' | 'reconnecting';

/**
 * A stable, self-recovering HLS video tile.
 *
 * Fetches the public HLS URL, plays it with hls.js, and transparently recovers
 * from fatal errors: NETWORK errors resume via startLoad() (escalating to a full
 * rebuild after repeated failures), MEDIA errors via recoverMediaError(), and any
 * other fatal error tears down and rebuilds after a short backoff. The retry loop
 * is unbounded so a tile heals itself whenever the stream comes back.
 *
 * Every connect (initial and each rebuild) passes through a module-level connect
 * gate so at most MAX_CONCURRENT_HLS_CONNECTS tiles set up their RTSP pull at
 * once — the NVR is never hit by 9 simultaneous DESCRIBEs. The slot is released
 * on the first playback signal, on a fatal error, on a safety timeout, or on
 * unmount (idempotent, so it can never leak and starve the gate).
 *
 * On unmount the hls instance is destroyed and the <video> source is nulled to
 * avoid worker/RTSP-session leaks.
 */
export const HlsTile = memo(function HlsTile({ nvrId, channel, name }: HlsTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const networkRecoversRef = useRef(0);
  const slotHeldRef = useRef(false);
  const slotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // true once scheduleRebuild() has run at least once — distinguishes the INITIAL
  // connect (plain URL fetch) from a REBUILD (force go2rtc to drop+re-pull the
  // dead/zombie stream). Read + reset at the top of start().
  const isRebuildRef = useRef(false);
  const [status, setStatus] = useState<TileStatus>('connecting');

  // Release this tile's connect-gate slot (idempotent) and clear its safety
  // timer. Safe to call from any path — connected, error, timeout, unmount.
  const freeSlot = useCallback((): void => {
    if (slotTimerRef.current) {
      clearTimeout(slotTimerRef.current);
      slotTimerRef.current = null;
    }
    if (slotHeldRef.current) {
      slotHeldRef.current = false;
      releaseConnectSlot();
    }
  }, []);

  useEffect(() => {
    let disposed = false;

    const clearRetryTimer = (): void => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const destroyHls = (): void => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };

    // Schedule a full rebuild (re-fetch URL + recreate hls) after a backoff. The
    // rebuild re-enters the connect gate, so free the current slot first.
    const scheduleRebuild = (): void => {
      if (disposed) return;
      freeSlot();
      // Mark the next start() as a REBUILD so it forces go2rtc to drop the dead
      // stream and re-pull, instead of re-fetching the same stale HLS URL.
      isRebuildRef.current = true;
      setStatus('reconnecting');
      destroyHls();
      clearRetryTimer();
      retryTimerRef.current = setTimeout(() => {
        void start();
      }, retryDelayWithJitter());
    };

    const start = async (): Promise<void> => {
      if (disposed) return;
      networkRecoversRef.current = 0;
      // Consume the rebuild flag for this attempt; a fresh initial connect uses
      // the plain URL fetch, a rebuild forces go2rtc to drop + re-pull.
      const isRebuild = isRebuildRef.current;
      isRebuildRef.current = false;

      // Wait for a connect slot so the grid comes up staggered instead of
      // firing every tile's RTSP setup at the NVR simultaneously.
      await acquireConnectSlot();
      if (disposed) {
        releaseConnectSlot();
        return;
      }
      slotHeldRef.current = true;
      slotTimerRef.current = setTimeout(freeSlot, CONNECT_SLOT_TIMEOUT_MS);

      try {
        // A rebuild forces go2rtc to drop the dead/zombie stream and re-pull
        // fresh (clearing the NVR's half-open session); the initial connect just
        // fetches the current URLs. If reconnect throws, the surrounding catch
        // calls scheduleRebuild() so the tile keeps retrying.
        const urls = isRebuild
          ? await api.reconnectPublicStream(nvrId, channel)
          : await api.getPublicStreamUrls(nvrId, channel);
        if (disposed || !videoRef.current) {
          freeSlot();
          return;
        }
        const hlsUrl = urls.hls;

        const { default: Hls } = await import('hls.js');
        if (disposed || !videoRef.current) {
          freeSlot();
          return;
        }

        if (Hls.isSupported()) {
          const hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 3 });
          hlsRef.current = hls;
          hls.loadSource(hlsUrl);
          hls.attachMedia(videoRef.current);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            videoRef.current?.play().catch(() => {});
          });

          // First buffered fragment == the stream is actually up. Release the
          // connect slot so the next queued tile can start its setup.
          hls.on(Hls.Events.FRAG_BUFFERED, () => {
            freeSlot();
          });

          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (!data.fatal || disposed) return;
            // The connect attempt has settled (it failed): free the slot before
            // any recovery so a stuck tile can't hold the gate.
            freeSlot();
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              networkRecoversRef.current += 1;
              // Try to resume in place a few times; if the network keeps failing,
              // tear down and re-fetch a fresh stream URL after a backoff.
              if (networkRecoversRef.current <= MAX_NETWORK_RECOVERS) {
                setStatus('reconnecting');
                hls.startLoad();
              } else {
                scheduleRebuild();
              }
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              setStatus('reconnecting');
              hls.recoverMediaError();
            } else {
              scheduleRebuild();
            }
          });
        } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          // Native HLS (Safari): assign the URL directly. The <video> 'playing'
          // event releases the slot; the safety timer covers a stall.
          videoRef.current.src = hlsUrl;
          videoRef.current.play().catch(() => {});
        } else {
          scheduleRebuild();
        }
      } catch {
        scheduleRebuild();
      }
    };

    void start();

    return () => {
      disposed = true;
      freeSlot();
      clearRetryTimer();
      destroyHls();
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
    };
  }, [nvrId, channel, freeSlot]);

  const label = name?.trim() || `CH${channel}`;
  const dotClass = status === 'playing' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)]';

  return (
    <div className="video-cell relative h-full w-full">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        onPlaying={() => {
          setStatus('playing');
          freeSlot(); // playback started — hand the connect slot to the next tile
        }}
        className="h-full w-full object-contain bg-black"
      />

      {/* Top-left channel/name label + status dot */}
      <div className="absolute top-0 left-0 flex items-center gap-1.5 px-2 py-1 max-w-full bg-gradient-to-br from-black/70 to-transparent">
        <span className={`status-dot ${dotClass}`} />
        <span className="text-[11px] font-medium text-white/90 truncate">{label}</span>
      </div>

      {/* Reconnecting overlay while the stream is down */}
      {status !== 'playing' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-[var(--color-text-muted)]">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent)]" />
          <span className="text-[11px]">Reconnecting…</span>
        </div>
      )}
    </div>
  );
});
