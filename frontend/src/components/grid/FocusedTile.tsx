import { useEffect } from 'react';
import { X } from 'lucide-react';
import { HlsTile } from './HlsTile';

interface FocusedTileProps {
  nvrId: number;
  channel: number;
  name: string;
  onClose: () => void;
}

/**
 * Single-camera focus view. Renders ONE large self-recovering HLS tile filling
 * the whole stage — the grid's tiles are unmounted while this is shown, so only
 * this one stream is ever live (keeps the internet RTSP pull minimal).
 *
 * Exits back to the grid via the Close (X) button, the Escape key, or a
 * double-click anywhere on the large tile.
 */
export function FocusedTile({ nvrId, channel, name, onClose }: FocusedTileProps) {
  // Escape closes focus while it's open.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="relative h-full w-full" onDoubleClick={onClose}>
      <HlsTile nvrId={nvrId} channel={channel} name={name} />

      {/* Header bar: camera name + close button. pointer-events-none lets the
          double-click-to-close pass through to the wrapper; the button opts
          back in. */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-b from-black/70 to-transparent">
        <span className="text-sm font-medium text-white/90 truncate">{name}</span>
        <button
          onClick={onClose}
          className="pointer-events-auto inline-flex items-center justify-center w-8 h-8 rounded-full bg-black/50 text-white/90 hover:bg-black/70 transition-colors"
          aria-label="Close"
          title="Close (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
