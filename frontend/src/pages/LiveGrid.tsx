import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ScanControls } from '../components/grid/ScanControls';
import { FocusedTile } from '../components/grid/FocusedTile';
import { LivePageGrid } from '../components/grid/LivePageGrid';
import { ZoneSidebar, groupNvrsByArea } from '../components/grid/ZoneSidebar';
import type { Area, PublicCamera, PublicNvr } from '../types/api';
import { Settings, Maximize2, Loader2, AlertTriangle, Video, MousePointerClick } from 'lucide-react';

// Grid layout: 2x2 (4 tiles) is the safe fallback when the NVR can't service a
// full 3x3 (9 tiles). Fewer tiles == fewer concurrent RTSP setups.
type GridLayout = '2x2' | '3x3';
const LAYOUT_STORAGE_KEY = 'liveGrid.layout';

// Scan (auto-sequence / patrol) interval, persisted across sessions.
const SCAN_INTERVAL_STORAGE_KEY = 'nvr_scan_interval';
const DEFAULT_SCAN_INTERVAL_SEC = 10;
const VALID_SCAN_INTERVALS = [5, 10, 15, 30];

function pageSizeFor(layout: GridLayout): number {
  return layout === '2x2' ? 4 : 9;
}

function loadLayout(): GridLayout {
  try {
    return localStorage.getItem(LAYOUT_STORAGE_KEY) === '2x2' ? '2x2' : '3x3';
  } catch {
    return '3x3';
  }
}

function loadScanInterval(): number {
  try {
    const stored = Number(localStorage.getItem(SCAN_INTERVAL_STORAGE_KEY));
    return VALID_SCAN_INTERVALS.includes(stored) ? stored : DEFAULT_SCAN_INTERVAL_SEC;
  } catch {
    return DEFAULT_SCAN_INTERVAL_SEC;
  }
}

// Delay after unmounting the old tiles before mounting the new ones. This lets
// go2rtc drop the old consumers and stop those RTSP pulls, guaranteeing the NVR
// never briefly sees more than one page's worth of simultaneous RTSP sessions.
const SWITCH_DELAY_MS = 1800;

/**
 * Public "Live Grid" main dashboard (no auth). A left sidebar groups NVRs by
 * zone (area); picking one loads its channels into a 2x2 or 3x3 grid of
 * self-recovering HLS tiles that stretch to fill the viewport.
 */
export function LiveGrid() {
  const [nvrs, setNvrs] = useState<PublicNvr[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [selectedNvrId, setSelectedNvrId] = useState<number | null>(null);
  const [cameras, setCameras] = useState<PublicCamera[]>([]);
  const [page, setPage] = useState(1);
  const [layout, setLayout] = useState<GridLayout>(loadLayout);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  // While `switching` is true NO tiles are mounted, so old RTSP pulls fully drain
  // before the new page's tiles mount.
  const [switching, setSwitching] = useState(false);
  // Scan mode auto-cycles pages so only one page (<= pageSize) is ever live.
  const [scanning, setScanning] = useState(false);
  const [scanIntervalSec, setScanIntervalSec] = useState<number>(loadScanInterval);
  // Single-camera focus: when set, the grid is unmounted and only this one
  // channel streams (keeps the internet RTSP pull minimal).
  const [focusedChannel, setFocusedChannel] = useState<number | null>(null);
  const switchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selectedNvr = useMemo(
    () => nvrs.find((n) => n.id === selectedNvrId) ?? null,
    [nvrs, selectedNvrId],
  );

  const pageSize = pageSizeFor(layout);

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil((selectedNvr?.max_channels ?? 0) / pageSize)),
    [selectedNvr, pageSize],
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
      setFocusedChannel(null);
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

  const handleSelectLayout = useCallback(
    (next: GridLayout) => {
      if (next === layout) return;
      try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, next);
      } catch {
        // Ignore storage failures (private mode / disabled storage).
      }
      setFocusedChannel(null);
      // Drain current tiles first so we never briefly exceed one page's tiles.
      switchWith(() => {
        setLayout(next);
        setPage(1);
      });
    },
    [layout, switchWith],
  );

  const handleFullscreen = useCallback(() => {
    rootRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  const handleToggleScan = useCallback(() => setScanning((prev) => !prev), []);

  const handleScanInterval = useCallback((sec: number) => {
    setScanIntervalSec(sec);
    try {
      localStorage.setItem(SCAN_INTERVAL_STORAGE_KEY, String(sec));
    } catch {
      // Ignore storage failures (private mode / disabled storage).
    }
  }, []);

  const handleFocusChannel = useCallback((channel: number) => {
    setFocusedChannel(channel);
  }, []);

  const handleCloseFocus = useCallback(() => setFocusedChannel(null), []);

  // Scan auto-advance: while scanning (and not focused, and there is more than
  // one page), cycle to the next page every `scanIntervalSec` via switchWith so
  // streams drain-and-remount cleanly and never exceed one page of concurrency.
  // The timer resets on any dependency change — scan toggle, focus, interval,
  // page (manual or auto), NVR, or layout — so a manual page click keeps
  // scanning from there.
  useEffect(() => {
    if (!scanning || focusedChannel !== null || pageCount <= 1) return;
    const timer = setInterval(() => {
      switchWith(() => setPage((prev) => (prev < pageCount ? prev + 1 : 1)));
    }, scanIntervalSec * 1000);
    return () => clearInterval(timer);
  }, [scanning, focusedChannel, pageCount, scanIntervalSec, page, selectedNvrId, layout, switchWith]);

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

          <div className="ml-auto flex items-center gap-2">
            {/* Scan (auto-sequence) controls: cycle pages so only one page is
                ever live — ideal for the bandwidth-limited internet link. */}
            {selectedNvr && (
              <ScanControls
                scanning={scanning}
                onToggleScan={handleToggleScan}
                intervalSec={scanIntervalSec}
                onIntervalChange={handleScanInterval}
                page={page}
                pageCount={pageCount}
              />
            )}

            {/* Layout toggle: 2x2 is the safe fallback when the NVR can't
                handle a full 3x3 (9 concurrent RTSP pulls). */}
            <div
              role="group"
              aria-label="Grid layout"
              className="inline-flex items-center gap-1 p-0.5 rounded-full bg-[var(--color-surface-raised)]"
            >
              {(['2x2', '3x3'] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => handleSelectLayout(opt)}
                  aria-pressed={layout === opt}
                  className={segmentClass(layout === opt)}
                >
                  {opt === '2x2' ? '2×2' : '3×3'}
                </button>
              ))}
            </div>

            <button
              onClick={handleFullscreen}
              className="inline-flex items-center justify-center w-8 h-8 rounded-full text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-raised)] transition-colors"
              aria-label="Fullscreen"
              title="Fullscreen"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
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

          {/* Single-camera focus: only this one stream is live; the grid tiles
              are unmounted so the internet RTSP pull stays minimal. */}
          {status === 'ready' && selectedNvr && focusedChannel !== null && (
            <FocusedTile
              nvrId={selectedNvr.id}
              channel={focusedChannel}
              name={cameraNameFor(focusedChannel) || `CH${focusedChannel}`}
              onClose={handleCloseFocus}
            />
          )}

          {status === 'ready' && selectedNvr && focusedChannel === null && (
            <LivePageGrid
              nvrId={selectedNvr.id}
              is2x2={layout === '2x2'}
              page={page}
              pageSize={pageSize}
              maxChannels={maxChannels}
              switching={switching}
              cameraNameFor={cameraNameFor}
              onFocusChannel={handleFocusChannel}
            />
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

function segmentClass(active: boolean): string {
  return `px-2.5 py-1 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
    active
      ? 'bg-[var(--color-accent)] text-white shadow-sm shadow-[var(--color-accent)]/30'
      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
  }`;
}
