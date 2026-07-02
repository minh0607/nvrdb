import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { CameraPopup } from '../components/viewer/CameraPopup';
import { VlcHelpModal } from '../components/viewer/VlcHelpModal';
import { useImageDimensions } from '../hooks/useImageDimensions';
import type { Area, Layout, LayoutDetail, Placement, ViewMode } from '../types/api';
import {
  Camera,
  Map,
  Settings,
  Loader2,
  AlertTriangle,
  HelpCircle,
  MonitorPlay,
} from 'lucide-react';

const MAX_OPEN = 6;
const TOAST_MS = 3200;

/**
 * Hand an rtsp:// URL to the OS so a registered handler (VLC) picks it up.
 * A synthetic <a> click is used instead of window.open, which browsers often
 * block for non-http protocols.
 */
function openExternal(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

interface OpenPopup {
  placement: Placement;
  zIndex: number;
}

/**
 * Public floor-plan viewer (no auth). Users pick an area (if any), then a layout,
 * then click camera markers to pop up live video. Concurrent popups are hard-capped
 * at MAX_OPEN to respect the NVR's simultaneous-stream limit.
 */
export function Viewer() {
  const [layouts, setLayouts] = useState<Layout[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<LayoutDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenPopup[]>([]);
  // Monotonic z-index counter kept in a ref so two rapid marker clicks can't read
  // the same stale value and assign duplicate z-indices.
  const zCounterRef = useRef(1000);
  const [toast, setToast] = useState<string | null>(null);
  const [defaultViewMode, setDefaultViewMode] = useState<ViewMode>('go2rtc');
  const [helpOpen, setHelpOpen] = useState(false);

  // Versioned image URL so dims (and the <img>) refresh after a replacement.
  const imageUrl = detail?.has_image ? api.layoutImageUrl(detail.id, detail.updated_at) : null;
  const dims = useImageDimensions(imageUrl);

  // Whether the flat "General" bucket (ungrouped layouts) has any layouts.
  const hasGeneral = useMemo(() => layouts.some((l) => l.area_id === null), [layouts]);

  // Layouts visible in the picker: filtered by area when areas exist, else all.
  const visibleLayouts = useMemo(
    () => (areas.length > 0 ? layouts.filter((l) => l.area_id === selectedAreaId) : layouts),
    [areas.length, layouts, selectedAreaId],
  );

  // Load areas + layouts once, then pick sensible defaults.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [areaList, layoutList] = await Promise.all([
          api.listAreas().catch(() => [] as Area[]),
          api.listLayouts(),
        ]);
        if (!active) return;
        const sortedAreas = [...areaList].sort((a, b) => a.sort_order - b.sort_order);
        setAreas(sortedAreas);
        setLayouts(layoutList);

        if (sortedAreas.length > 0) {
          // Ordered candidates: named areas, then General (null) if it has layouts.
          const candidates: (number | null)[] = sortedAreas.map((a) => a.id);
          if (layoutList.some((l) => l.area_id === null)) candidates.push(null);
          const firstWithLayouts = candidates.find((aid) =>
            layoutList.some((l) => l.area_id === aid),
          );
          const chosenArea =
            firstWithLayouts === undefined ? candidates[0] ?? null : firstWithLayouts;
          setSelectedAreaId(chosenArea);
          setSelectedId(layoutList.find((l) => l.area_id === chosenArea)?.id ?? null);
        } else {
          setSelectedId((prev) => prev ?? layoutList[0]?.id ?? null);
        }
        setStatus('ready');
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Could not load layouts');
        setStatus('error');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Load the global default view mode (fallback to go2rtc on error).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const settings = await api.getSettings();
        if (active) setDefaultViewMode(settings.default_view_mode);
      } catch {
        if (active) setDefaultViewMode('go2rtc');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Load the selected layout's detail (image meta + placements).
  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetail(null);
    (async () => {
      try {
        const d = await api.getLayout(selectedId);
        if (active) setDetail(d);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Could not load layout');
          setStatus('error');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedId]);

  // Auto-dismiss the toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const handleSelectArea = useCallback(
    (areaId: number | null) => {
      setSelectedAreaId(areaId);
      setSelectedId(layouts.find((l) => l.area_id === areaId)?.id ?? null);
    },
    [layouts],
  );

  const raise = useCallback((placementId: number) => {
    const next = zCounterRef.current + 1;
    zCounterRef.current = next;
    setOpen((prev) =>
      prev.map((p) => (p.placement.id === placementId ? { ...p, zIndex: next } : p)),
    );
  }, []);

  const openGo2rtc = useCallback(
    (placement: Placement) => {
      setOpen((prev) => {
        // Already open → just focus it.
        if (prev.some((p) => p.placement.id === placement.id)) {
          raise(placement.id);
          return prev;
        }
        if (prev.length >= MAX_OPEN) {
          setToast('Maximum 6 cameras at once — close one to open another.');
          return prev;
        }
        const next = zCounterRef.current + 1;
        zCounterRef.current = next;
        return [...prev, { placement, zIndex: next }];
      });
    },
    [raise],
  );

  const openVlc = useCallback(async (placement: Placement) => {
    setToast('Opening VLC… (this PC needs VLC installed and the setup script run once)');
    try {
      const { rtsp } = await api.getVlcUrl(placement.nvr_id, placement.channel);
      openExternal(rtsp);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not open VLC');
    }
  }, []);

  const handleMarkerClick = useCallback(
    (placement: Placement) => {
      const mode = placement.view_mode ?? defaultViewMode;
      if (mode === 'vlc') {
        void openVlc(placement);
      } else {
        openGo2rtc(placement);
      }
    },
    [defaultViewMode, openVlc, openGo2rtc],
  );

  const closePopup = useCallback((placementId: number) => {
    setOpen((prev) => prev.filter((p) => p.placement.id !== placementId));
  }, []);

  const stageBackground = useMemo(() => {
    if (detail?.has_image && imageUrl) {
      return (
        <img
          src={imageUrl}
          alt={detail.name}
          className="absolute inset-0 w-full h-full object-fill select-none pointer-events-none"
          draggable={false}
        />
      );
    }
    return null;
  }, [detail, imageUrl]);

  const areaButtonClass = (active: boolean) =>
    `px-3 py-1 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
      active
        ? 'bg-[var(--color-accent)] text-white shadow-sm shadow-[var(--color-accent)]/30'
        : 'text-[var(--color-text-muted)] bg-[var(--color-surface-raised)] hover:text-[var(--color-text)]'
    }`;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-bg)]">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-1.5 rounded-lg bg-[var(--color-accent)]/10">
            <Map className="w-5 h-5 text-[var(--color-accent)]" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-tight truncate">Camera Layout</h1>
            <p className="text-[10px] text-[var(--color-text-dim)] font-mono">
              {open.length}/{MAX_OPEN} cameras open
            </p>
          </div>

          {/* Area buttons */}
          {areas.length > 0 && (
            <div className="flex items-center gap-1.5 ml-2 overflow-x-auto">
              {areas.map((area) => (
                <button
                  key={area.id}
                  onClick={() => handleSelectArea(area.id)}
                  className={areaButtonClass(selectedAreaId === area.id)}
                >
                  {area.name}
                </button>
              ))}
              {hasGeneral && (
                <button
                  onClick={() => handleSelectArea(null)}
                  className={areaButtonClass(selectedAreaId === null)}
                >
                  General
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => setHelpOpen(true)}
            className="inline-flex items-center justify-center w-8 h-8 rounded-full text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-raised)] transition-colors"
            aria-label="Help: enable Open in VLC"
            title="Enable 'Open in VLC'"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-raised)] rounded-lg transition-colors"
          >
            <MonitorPlay className="w-3.5 h-3.5" />
            Live View
          </Link>
          <Link
            to="/admin"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-raised)] rounded-lg transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            Admin
          </Link>
        </div>
      </header>

      {/* Layout picker */}
      {visibleLayouts.length > 0 && (
        <div className="flex items-center gap-2 px-5 py-2.5 overflow-x-auto border-b border-[var(--color-border-subtle)]">
          {visibleLayouts.map((l) => (
            <button
              key={l.id}
              onClick={() => setSelectedId(l.id)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
                l.id === selectedId
                  ? 'bg-[var(--color-accent)] text-white shadow-sm shadow-[var(--color-accent)]/30'
                  : 'text-[var(--color-text-muted)] bg-[var(--color-surface-raised)] hover:text-[var(--color-text)]'
              }`}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}

      {/* Stage / states */}
      <main className="flex-1 min-h-0 p-4">
        {status === 'loading' && (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--color-text-dim)]">
            <Loader2 className="w-7 h-7 animate-spin text-[var(--color-accent)]" />
            <span className="text-sm">Loading layout…</span>
          </div>
        )}

        {status === 'error' && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
            <AlertTriangle className="w-8 h-8 text-red-400" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {status === 'ready' && layouts.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="p-4 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] mb-4">
              <Map className="w-10 h-10 text-[var(--color-text-dim)]" />
            </div>
            <h2 className="text-base font-semibold mb-1">No layouts yet</h2>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
              Create your first layout in the admin area.
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

        {status === 'ready' && layouts.length > 0 && (
          <div className="h-full w-full flex items-center justify-center">
            <div
              className={`layout-stage max-w-full max-h-full ${detail?.has_image ? '' : 'layout-stage--grid'}`}
              style={{
                aspectRatio:
                  detail?.width && detail?.height
                    ? `${detail.width} / ${detail.height}`
                    : dims
                      ? `${dims.w} / ${dims.h}`
                      : '16 / 9',
              }}
            >
              {stageBackground}
              {detail?.placements.map((p) => {
                const label = p.label?.trim() || p.camera_name?.trim() || `CH${p.channel}`;
                const isVlc = (p.view_mode ?? defaultViewMode) === 'vlc';
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="cam-marker"
                    style={{ left: `${p.x}%`, top: `${p.y}%` }}
                    onClick={() => handleMarkerClick(p)}
                    title={isVlc ? `${label} · open in VLC` : label}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span className="max-w-[140px] truncate">{label}</span>
                    {isVlc && (
                      <span className="px-1 py-px rounded-sm bg-white/20 text-[8px] font-bold leading-none tracking-wide">
                        VLC
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Floating camera popups */}
      {open.map((p, i) => (
        <CameraPopup
          key={p.placement.id}
          placement={p.placement}
          zIndex={p.zIndex}
          initialOffset={{ x: 80 + i * 36, y: 120 + i * 36 }}
          onFocus={() => raise(p.placement.id)}
          onClose={() => closePopup(p.placement.id)}
        />
      ))}

      {/* VLC help modal */}
      {helpOpen && <VlcHelpModal onClose={() => setHelpOpen(false)} />}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[5000] px-4 py-2.5 text-xs font-medium text-white bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg shadow-[var(--shadow-elevated)]">
          {toast}
        </div>
      )}
    </div>
  );
}
