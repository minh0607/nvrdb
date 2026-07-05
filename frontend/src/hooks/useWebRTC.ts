import { useEffect, useRef, useState, useCallback } from 'react';
import type Hls from 'hls.js';

// ── Connect concurrency gate ────────────────────────────────────────────────
// Establishing many WebRTC peer connections at once (e.g. loading a 16-cam wall)
// overwhelms the browser and go2rtc, so most streams stall. Limit how many are in
// the *connecting* phase simultaneously; a slot frees as soon as a stream connects
// (or fails), letting the next start. A safety timer releases a stuck slot so the
// gate can never deadlock.
const MAX_CONCURRENT_CONNECTS = 4;
const CONNECT_SLOT_TIMEOUT_MS = 12_000;
let activeConnects = 0;
const connectQueue: Array<() => void> = [];

function acquireConnectSlot(): Promise<void> {
  if (activeConnects < MAX_CONCURRENT_CONNECTS) {
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

interface UseWebRTCOptions {
  webrtcUrl: string | null;
  hlsFallbackUrl?: string | null;
}

interface UseWebRTCResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: 'idle' | 'connecting' | 'connected' | 'failed' | 'hls-fallback';
  error: string | null;
  retry: () => void;
}

/**
 * Hook that manages a WebRTC connection to go2rtc.
 *
 * go2rtc WebRTC flow:
 *   1. POST SDP offer to /api/webrtc?src=<stream>
 *   2. Receive SDP answer
 *   3. Set remote description on RTCPeerConnection
 *   4. Attach remote stream to <video> element
 *
 * Falls back to HLS if WebRTC fails.
 */
export function useWebRTC({ webrtcUrl, hlsFallbackUrl }: UseWebRTCOptions): UseWebRTCResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const slotHeldRef = useRef(false);
  const slotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<UseWebRTCResult['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const retryCountRef = useRef(0);
  // Bumped on every cleanup (url change / unmount / retry). A connect attempt
  // captures the value after its own cleanup() and re-checks it after awaiting
  // a connect slot: if it changed, the attempt is stale and must NOT create a
  // peer connection — doing so leaked an unclosable RTCPeerConnection (and the
  // RTSP session behind it) whenever the component unmounted while queued.
  const generationRef = useRef(0);

  // Release this hook's connect-gate slot (idempotent) and clear its safety timer.
  const freeSlot = useCallback(() => {
    if (slotTimerRef.current) {
      clearTimeout(slotTimerRef.current);
      slotTimerRef.current = null;
    }
    if (slotHeldRef.current) {
      slotHeldRef.current = false;
      releaseConnectSlot();
    }
  }, []);

  const cleanup = useCallback(() => {
    generationRef.current++; // invalidate any connect attempt queued for a slot
    freeSlot();
    // Abort any in-flight SDP signaling fetch so its rejection doesn't fire the
    // fallback/error path after we've intentionally torn the connection down.
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    // Destroy the HLS.js instance — otherwise its worker, timers, and the RTSP
    // session behind it leak (16x in a full grid).
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [freeSlot]);

  const loadHlsFallback = useCallback(async (url: string) => {
    if (!videoRef.current) return;

    try {
      // Dynamic import to avoid bundling HLS.js when not needed
      const { default: Hls } = await import('hls.js');

      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(videoRef.current);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoRef.current?.play().catch(() => {});
        });
        // Without this, a dead HLS source leaves the UI stuck on the "HLS" badge
        // forever with no error and no retry. Surface fatal errors as 'failed'.
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (data.fatal) {
            hls.destroy();
            if (hlsRef.current === hls) hlsRef.current = null;
            setError('Stream unavailable (HLS)');
            setStatus('failed');
          }
        });
      } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (Safari)
        videoRef.current.src = url;
        videoRef.current.play().catch(() => {});
      } else {
        setError('Browser does not support HLS');
        setStatus('failed');
      }
    } catch {
      setError('Failed to load HLS player');
      setStatus('failed');
    }
  }, []);

  const connectWebRTC = useCallback(async () => {
    if (!webrtcUrl) return;

    cleanup();
    const generation = generationRef.current;
    setStatus('connecting');
    setError(null);

    // Wait for a connect slot so we don't stampede the browser/go2rtc.
    await acquireConnectSlot();
    if (generation !== generationRef.current) {
      // Torn down (unmount / url change) while queued — hand the slot back and
      // bail before creating a peer connection nothing will ever close.
      releaseConnectSlot();
      return;
    }
    slotHeldRef.current = true;
    slotTimerRef.current = setTimeout(freeSlot, CONNECT_SLOT_TIMEOUT_MS);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      // No STUN/TURN: this is an isolated LAN (airgap). WebRTC connects directly
      // via host candidates (the browser's LAN IP + go2rtc's advertised LAN IP),
      // so the client never contacts any external server. Add an ICE server here
      // only if this is ever deployed across NAT/the internet.
      const pc = new RTCPeerConnection({ iceServers: [] });
      pcRef.current = pc;

      // Receive remote video track
      pc.ontrack = (event) => {
        // Gate against late events from a torn-down attempt's pc: without this
        // a stale ontrack could clobber the replacement's video and free ITS
        // connect slot (same gap the generation guard closes in catch).
        if (generation !== generationRef.current) return;
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          setStatus('connected');
          retryCountRef.current = 0;
          freeSlot(); // connected — let the next queued stream start
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (generation !== generationRef.current) return; // stale pc event
        // 'disconnected' is transient and frequently self-recovers (esp. on a
        // busy LAN); only a hard 'failed' is terminal.
        if (pc.iceConnectionState === 'failed') {
          setStatus('failed');
          setError('WebRTC connection lost');
        }
      };

      // We need a transceiver to receive video
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      // Create and send SDP offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const response = await fetch(webrtcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'offer', sdp: offer.sdp }),
        signal: abort.signal,
      });

      if (!response.ok) {
        throw new Error(`WebRTC signaling failed: ${response.status}`);
      }

      // Validate the answer shape before handing it to the browser — the
      // signaling server may return an error body instead of an SDP answer.
      const raw: unknown = await response.json();
      if (
        typeof raw !== 'object' ||
        raw === null ||
        typeof (raw as RTCSessionDescriptionInit).sdp !== 'string'
      ) {
        throw new Error('Invalid SDP answer from signaling server');
      }
      await pc.setRemoteDescription(new RTCSessionDescription(raw as RTCSessionDescriptionInit));
    } catch (err) {
      // A stale attempt (torn down mid-flight) must exit WITHOUT touching the
      // shared slot/status refs: cleanup() already freed its slot, and calling
      // freeSlot() here would release the slot now held by its replacement.
      if (generation !== generationRef.current) return;
      freeSlot(); // connect attempt settled (failed) — free the slot
      // An intentional teardown (cleanup → abort) is not a real failure.
      if (err instanceof DOMException && err.name === 'AbortError') return;

      const message = err instanceof Error ? err.message : 'WebRTC connection failed';
      setError(message);

      // Try HLS fallback
      if (hlsFallbackUrl && videoRef.current) {
        setStatus('hls-fallback');
        loadHlsFallback(hlsFallbackUrl);
      } else {
        setStatus('failed');
      }
    }
  }, [webrtcUrl, hlsFallbackUrl, cleanup, loadHlsFallback, freeSlot]);

  const retry = useCallback(() => {
    retryCountRef.current++;
    connectWebRTC();
  }, [connectWebRTC]);

  useEffect(() => {
    if (webrtcUrl) {
      connectWebRTC();
    }
    return cleanup;
  }, [webrtcUrl, connectWebRTC, cleanup]);

  return { videoRef, status, error, retry };
}
