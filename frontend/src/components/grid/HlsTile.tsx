import { memo, useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import { api } from '../../lib/api';
import { Loader2 } from 'lucide-react';

interface HlsTileProps {
  nvrId: number;
  channel: number;
  name: string;
}

// Backoff (ms) before re-fetching the stream URL and rebuilding the player after
// a hard failure. Kept short so a tile self-heals quickly once the stream returns.
const RETRY_DELAY_MS = 3500;
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
 * is unbounded (every ~3.5s) so a tile heals itself whenever the stream comes back.
 * On unmount the hls instance is destroyed and the <video> source is nulled to
 * avoid worker/RTSP-session leaks.
 */
export const HlsTile = memo(function HlsTile({ nvrId, channel, name }: HlsTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const networkRecoversRef = useRef(0);
  const [status, setStatus] = useState<TileStatus>('connecting');

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

    // Schedule a full rebuild (re-fetch URL + recreate hls) after a backoff.
    const scheduleRebuild = (): void => {
      if (disposed) return;
      setStatus('reconnecting');
      destroyHls();
      clearRetryTimer();
      retryTimerRef.current = setTimeout(() => {
        void start();
      }, RETRY_DELAY_MS);
    };

    const start = async (): Promise<void> => {
      if (disposed) return;
      networkRecoversRef.current = 0;
      try {
        const urls = await api.getPublicStreamUrls(nvrId, channel);
        if (disposed || !videoRef.current) return;
        const hlsUrl = urls.hls;

        const { default: Hls } = await import('hls.js');
        if (disposed || !videoRef.current) return;

        if (Hls.isSupported()) {
          const hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 3 });
          hlsRef.current = hls;
          hls.loadSource(hlsUrl);
          hls.attachMedia(videoRef.current);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            videoRef.current?.play().catch(() => {});
          });

          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (!data.fatal || disposed) return;
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
          // Native HLS (Safari): assign the URL directly.
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
      clearRetryTimer();
      destroyHls();
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
    };
  }, [nvrId, channel]);

  const label = name?.trim() || `CH${channel}`;
  const dotClass = status === 'playing' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)]';

  return (
    <div className="video-cell relative h-full w-full">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        onPlaying={() => setStatus('playing')}
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
