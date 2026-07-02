import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { HlsTile } from '../components/grid/HlsTile';
import { ZoneSidebar, groupNvrsByArea } from '../components/grid/ZoneSidebar';
import type { Area, PublicCamera, PublicNvr } from '../types/api';
import { Settings, Maximize2, Loader2, AlertTriangle, Video, MousePointerClick } from 'lucide-react';

// Fixed 3x3 layout: at most 9 live streams mounted at once.
const PAGE_SIZE = 9;
// Delay after unmounting the old page's tiles before mounting the new page's.
// This lets go2rtc drop the old consumers and stop those RTSP pulls, guaranteeing
// the NVR never sees >9 simultaneous RTSP sessions (it crashes above ~10).
const SWITCH_DELAY_MS = 1800;

/**
 * Public "Live Grid" main dashboard (no auth). A left sidebar groups NVRs by
 * zone (area); picking one loads its channels into a 3x3 grid of self-recovering
 * HLS tiles that stretch to fill the viewport.
 */
export function LiveGrid() {
  const [nvrs, setNvrs] = useState<PublicNvr[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [selectedNvrId, setSelectedNvrId] = useState<number | null>(null);
  const [cameras, setCameras] = useState<PublicCamera[]>([]);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  // While `switching` is true NO tiles are mounted, so old RTSP pulls fully drain
  // before the new page's tiles mount.
  const [switching, setSwitching] = useState(false);
  const switchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selectedNvr = useMemo(
    () => nvrs.find((n) => n.id === selectedNvrId) ?? null,
    [nvrs, selectedNvrId],
  );

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil((selectedNvr?.max_channels ?? 0) / PAGE_SIZE)),
    [selectedNvr],
  );

  const cameraNameFor = useCallback(
    (channel: number): string | undefined =>
      cameras.find((c) => c.channel === channel)?.name?.trim() || undefined,
    [cameras],
  );

  // Load areas + NVRs once, then default-select the first NVR of the first
  // non-empty zone group.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [areaList, nvrList] = await Promise.all([api.listAreas(), api.getPublicNvrs()]);
        if (!active) return;
        setAreas(areaList);
        setNvrs(nvrList);
        const groups = groupNvrsByArea(areaList, nvrList);
        const firstNvr = groups.find((g) => g.nvrs.length > 0)?.nvrs[0] ?? null;
        setSelectedNvrId(firstNvr?.id ?? null);
        setStatus('ready');
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Could not load NVRs');
        setStatus('error');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Load camera names whenever the selected NVR changes.
  useEffect(() => {
    if (selectedNvrId === null) {
      setCameras([]);
      return;
    }
    let active = true;
    (async () => {
      try {
        const list = await api.getPublicNvrCameras(selectedNvrId);
        if (active) setCameras(list);
      } catch {
        if (active) setCameras([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedNvrId]);

  // Clean up any pending switch timer on unmount.
  useEffect(() => {
    return () => {
      if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
    };
  }, []);

  // Shared switch helper: unmount current tiles, wait, then apply the change.
  const switchWith = useCallback((apply: () => void) => {
    setSwitching(true);
    if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
    switchTimerRef.current = setTimeout(() => {
      apply();
      setSwitching(false);
    }, SWITCH_DELAY_MS);
  }, []);

  const handleSelectNvr = useCallback(
    (id: number) => {
      if (id === selectedNvrId) return;
      switchWith(() => {
        setSelectedNvrId(id);
        setPage(1);
      });
    },
    [selectedNvrId, switchWith],
  );

  const handleSelectPage = useCallback(
    (nextPage: number) => {
      if (nextPage === page) return;
      switchWith(() => setPage(nextPage));
    },
    [page, switchWith],
  );

  const handleFullscreen = useCallback(() => {
    rootRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  const maxChannels = selectedNvr?.max_channels ?? 0;

  return (
    <div ref={rootRef} className="h-screen flex bg-[var(--color-bg)]">
      <ZoneSidebar
        areas={areas}
        nvrs={nvrs}
        selectedNvrId={selectedNvrId}
        onSelectNvr={handleSelectNvr}
      />

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">
              {selectedNvr ? selectedNvr.name : 'No NVR selected'}
            </h2>
            {selectedNvr && (
              <p className="text-[10px] text-[var(--color-text-dim)] font-mono">
                Page {page}/{pageCount}
              </p>
            )}
          </div>

          {/* Page tabs */}
          {selectedNvr && pageCount > 1 && (
            <div className="flex items-center gap-1.5 ml-2 overflow-x-auto">
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                <button key={p} onClick={() => handleSelectPage(p)} className={pillClass(p === page)}>
                  Page {p}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={handleFullscreen}
            className="ml-auto inline-flex items-center justify-center w-8 h-8 rounded-full text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-raised)] transition-colors"
            aria-label="Fullscreen"
            title="Fullscreen"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </header>

        {/* Stage / states */}
        <main className="flex-1 min-h-0 p-3">
          {status === 'loading' && (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--color-text-dim)]">
              <Loader2 className="w-7 h-7 animate-spin text-[var(--color-accent)]" />
              <span className="text-sm">Loading…</span>
            </div>
          )}

          {status === 'error' && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
              <AlertTriangle className="w-8 h-8 text-red-400" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {status === 'ready' && nvrs.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="p-4 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] mb-4">
                <Video className="w-10 h-10 text-[var(--color-text-dim)]" />
              </div>
              <h2 className="text-base font-semibold mb-1">No NVRs configured</h2>
              <p className="text-sm text-[var(--color-text-muted)] mb-4">
                Add an NVR in the admin area to start streaming.
              </p>
              <Link
                to="/admin"
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-lg transition-colors"
              >
                <Settings className="w-4 h-4" />
                Open admin
              </Link>
            </div>
          )}

          {status === 'ready' && nvrs.length > 0 && !selectedNvr && (
            <div className="h-full flex flex-col items-center justify-center text-center text-[var(--color-text-dim)]">
              <MousePointerClick className="w-8 h-8 mb-3 opacity-60" />
              <p className="text-sm">Pick an NVR from the sidebar to start streaming.</p>
            </div>
          )}

          {status === 'ready' && selectedNvr && (
            <div className="relative h-full w-full">
              <div className="grid grid-cols-3 grid-rows-3 gap-2 h-full w-full">
                {Array.from({ length: PAGE_SIZE }, (_, slot) => {
                  const channel = (page - 1) * PAGE_SIZE + slot + 1;
                  const hasCamera = channel <= maxChannels;
                  return (
                    <div key={channel} className="relative min-h-0 min-w-0">
                      {hasCamera && !switching ? (
                        <HlsTile
                          nvrId={selectedNvr.id}
                          channel={channel}
                          name={cameraNameFor(channel) || `CH${channel}`}
                        />
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
          )}
        </main>
      </div>
    </div>
  );
}

function pillClass(active: boolean): string {
  return `px-3.5 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
    active
      ? 'bg-[var(--color-accent)] text-white shadow-sm shadow-[var(--color-accent)]/30'
      : 'text-[var(--color-text-muted)] bg-[var(--color-surface-raised)] hover:text-[var(--color-text)]'
  }`;
}
