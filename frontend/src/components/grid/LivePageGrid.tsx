import { Loader2, Video } from 'lucide-react';
import { HlsTile } from './HlsTile';

interface LivePageGridProps {
  nvrId: number;
  is2x2: boolean;
  page: number;
  pageSize: number;
  maxChannels: number;
  // While switching, no tiles are mounted so old RTSP pulls fully drain.
  switching: boolean;
  cameraNameFor: (channel: number) => string | undefined;
  onFocusChannel: (channel: number) => void;
}

/**
 * The 2x2 / 3x3 page of self-recovering HLS tiles for the public Live Grid.
 * Double-clicking a live cell focuses that single camera. Only one page's worth
 * of tiles is ever mounted, and none are mounted while `switching`, preserving
 * the NVR concurrency guarantee.
 */
export function LivePageGrid({
  nvrId,
  is2x2,
  page,
  pageSize,
  maxChannels,
  switching,
  cameraNameFor,
  onFocusChannel,
}: LivePageGridProps) {
  return (
    <div className="relative h-full w-full">
      <div
        className={`grid gap-2 h-full w-full ${
          is2x2 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-3 grid-rows-3'
        }`}
      >
        {Array.from({ length: pageSize }, (_, slot) => {
          const channel = (page - 1) * pageSize + slot + 1;
          const hasCamera = channel <= maxChannels;
          return (
            <div
              key={channel}
              className="relative min-h-0 min-w-0"
              onDoubleClick={hasCamera ? () => onFocusChannel(channel) : undefined}
            >
              {hasCamera && !switching ? (
                <HlsTile nvrId={nvrId} channel={channel} name={cameraNameFor(channel) || `CH${channel}`} />
              ) : (
                <div className="video-cell flex items-center justify-center h-full bg-black/40">
                  {hasCamera ? null : (
                    <div className="text-center text-[var(--color-text-dim)]">
                      <Video className="w-6 h-6 mx-auto mb-1 opacity-30" />
                      <p className="text-[11px]">No camera</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Switching overlay: shown while old tiles drain before new ones mount. */}
      {switching && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-[var(--color-text-muted)] rounded-lg">
          <Loader2 className="w-7 h-7 animate-spin text-[var(--color-accent)]" />
          <span className="text-sm">Switching…</span>
        </div>
      )}
    </div>
  );
}
