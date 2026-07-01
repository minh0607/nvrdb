import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { VideoPlayer } from '../video/VideoPlayer';
import type { Placement, StreamUrls } from '../../types/api';
import { X, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';

const POPUP_WIDTH = 480;
const POPUP_HEIGHT = 300;
const HEADER_HEIGHT = 36;

interface CameraPopupProps {
  placement: Placement;
  zIndex: number;
  /** Initial top-left position, staggered per popup so they don't fully overlap. */
  initialOffset: { x: number; y: number };
  onClose: () => void;
  /** Raise this popup above the others (called on header press). */
  onFocus: () => void;
}

interface Position {
  x: number;
  y: number;
}

/** Keep the popup's top-left within the viewport (leaving the header grabbable). */
function clampToViewport({ x, y }: Position): Position {
  const maxX = Math.max(0, window.innerWidth - POPUP_WIDTH);
  const maxY = Math.max(0, window.innerHeight - HEADER_HEIGHT);
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY),
  };
}

/**
 * Draggable floating window that plays one placement's live stream.
 *
 * Stream URLs are fetched from the PUBLIC endpoint on mount. On close the whole
 * component (including VideoPlayer/useWebRTC) unmounts, which releases the
 * go2rtc peer connection via useWebRTC's cleanup — no extra teardown needed.
 */
export function CameraPopup({
  placement,
  zIndex,
  initialOffset,
  onClose,
  onFocus,
}: CameraPopupProps) {
  const [position, setPosition] = useState<Position>(() => clampToViewport(initialOffset));
  const [streamUrls, setStreamUrls] = useState<StreamUrls | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  // Drag state kept in a ref so pointermove doesn't re-run effects.
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(
    null,
  );

  const title = placement.label?.trim() || `CH${placement.channel}`;

  const loadStream = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const urls = await api.getPublicStreamUrls(placement.nvr_id, placement.channel);
      setStreamUrls(urls);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải luồng camera');
      setStatus('error');
    }
  }, [placement.nvr_id, placement.channel]);

  useEffect(() => {
    loadStream();
  }, [loadStream]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const next = clampToViewport({
      x: drag.originX + (e.clientX - drag.startX),
      y: drag.originY + (e.clientY - drag.startY),
    });
    setPosition(next);
  }, []);

  const endDrag = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    },
    [handlePointerMove],
  );

  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Ignore drags that start on the close button.
    if ((e.target as HTMLElement).closest('button')) return;
    onFocus();
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: position.x,
      originY: position.y,
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  };

  // Detach any lingering global listeners if the popup unmounts mid-drag.
  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, [handlePointerMove, endDrag]);

  return (
    <div
      className="cam-popup"
      style={{
        left: position.x,
        top: position.y,
        width: POPUP_WIDTH,
        height: POPUP_HEIGHT,
        zIndex,
      }}
      onPointerDown={onFocus}
    >
      {/* Header (drag handle) */}
      <div
        className="cam-popup__header flex items-center justify-between px-3 bg-[var(--color-surface-raised)] border-b border-[var(--color-border)]"
        style={{ height: HEADER_HEIGHT }}
        onPointerDown={handleHeaderPointerDown}
      >
        <span className="text-xs font-medium text-[var(--color-text)] truncate">
          {title}
          <span className="ml-2 font-mono text-[10px] text-[var(--color-text-dim)]">
            NVR{placement.nvr_id}·CH{placement.channel}
          </span>
        </span>
        <button
          onClick={onClose}
          className="p-1 -mr-1 text-[var(--color-text-dim)] hover:text-red-400 rounded transition-colors"
          aria-label="Đóng"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="relative flex-1 min-h-0 bg-black">
        {status === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--color-text-dim)]">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent)]" />
            <span className="text-xs">Đang tải luồng…</span>
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-4">
            <AlertTriangle className="w-7 h-7 text-red-400" />
            <p className="text-xs text-red-300">{error ?? 'Không thể tải luồng camera'}</p>
            <button
              onClick={loadStream}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-md transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Thử lại
            </button>
          </div>
        )}

        {status === 'ready' && <VideoPlayer streamUrls={streamUrls} cameraName={title} />}
      </div>
    </div>
  );
}
