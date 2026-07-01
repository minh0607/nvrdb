import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { CameraPopup } from '../components/viewer/CameraPopup';
import { useImageDimensions } from '../hooks/useImageDimensions';
import type { Layout, LayoutDetail, Placement } from '../types/api';
import { Camera, Map, Settings, Loader2, AlertTriangle } from 'lucide-react';

const MAX_OPEN = 6;
const TOAST_MS = 3200;

interface OpenPopup {
  placement: Placement;
  zIndex: number;
}

/**
 * Public floor-plan viewer (no auth). Users pick a layout, then click camera
 * markers to pop up live video. Concurrent popups are hard-capped at MAX_OPEN
 * to respect the NVR's simultaneous-stream limit.
 */
export function Viewer() {
  const [layouts, setLayouts] = useState<Layout[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<LayoutDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenPopup[]>([]);
  // Monotonic z-index counter kept in a ref so two rapid marker clicks can't read
  // the same stale value and assign duplicate z-indices.
  const zCounterRef = useRef(1000);
  const [toast, setToast] = useState<string | null>(null);

  // Versioned image URL so dims (and the <img>) refresh after a replacement.
  const imageUrl = detail?.has_image ? api.layoutImageUrl(detail.id, detail.updated_at) : null;
  const dims = useImageDimensions(imageUrl);

  // Load the list of layouts once.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await api.listLayouts();
        if (!active) return;
        setLayouts(list);
        setSelectedId((prev) => prev ?? list[0]?.id ?? null);
        setStatus('ready');
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Không thể tải sơ đồ');
        setStatus('error');
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
          setError(err instanceof Error ? err.message : 'Không thể tải sơ đồ');
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

  const raise = useCallback((placementId: number) => {
    const next = zCounterRef.current + 1;
    zCounterRef.current = next;
    setOpen((prev) =>
      prev.map((p) => (p.placement.id === placementId ? { ...p, zIndex: next } : p)),
    );
  }, []);

  const handleMarkerClick = useCallback(
    (placement: Placement) => {
      setOpen((prev) => {
        // Already open → just focus it.
        if (prev.some((p) => p.placement.id === placement.id)) {
          raise(placement.id);
          return prev;
        }
        if (prev.length >= MAX_OPEN) {
          setToast('Tối đa 6 camera cùng lúc — đóng bớt để mở thêm.');
          return prev;
        }
        const next = zCounterRef.current + 1;
        zCounterRef.current = next;
        return [...prev, { placement, zIndex: next }];
      });
    },
    [raise],
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

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-bg)]">
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-1.5 rounded-lg bg-[var(--color-accent)]/10">
            <Map className="w-5 h-5 text-[var(--color-accent)]" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-tight truncate">Sơ đồ Camera</h1>
            <p className="text-[10px] text-[var(--color-text-dim)] font-mono">
              {open.length}/{MAX_OPEN} camera đang mở
            </p>
          </div>
        </div>
        <Link
          to="/admin"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-raised)] rounded-lg transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
          Admin
        </Link>
      </header>

      {/* Layout picker */}
      {layouts.length > 0 && (
        <div className="flex items-center gap-2 px-5 py-2.5 overflow-x-auto border-b border-[var(--color-border-subtle)]">
          {layouts.map((l) => (
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
            <span className="text-sm">Đang tải sơ đồ…</span>
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
            <h2 className="text-base font-semibold mb-1">Chưa có sơ đồ nào</h2>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
              Tạo sơ đồ đầu tiên trong trang quản trị.
            </p>
            <Link
              to="/admin"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-lg transition-colors"
            >
              <Settings className="w-4 h-4" />
              Mở trang quản trị
            </Link>
          </div>
        )}

        {status === 'ready' && layouts.length > 0 && (
          <div className="h-full w-full flex items-center justify-center">
            <div
              className={`layout-stage max-w-full max-h-full ${detail?.has_image ? '' : 'layout-stage--grid'}`}
              style={{ aspectRatio: dims ? `${dims.w} / ${dims.h}` : '16 / 9' }}
            >
              {stageBackground}
              {detail?.placements.map((p) => {
                const label = p.label?.trim() || `CH${p.channel}`;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="cam-marker"
                    style={{ left: `${p.x}%`, top: `${p.y}%` }}
                    onClick={() => handleMarkerClick(p)}
                    title={label}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span className="max-w-[140px] truncate">{label}</span>
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

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[5000] px-4 py-2.5 text-xs font-medium text-white bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg shadow-[var(--shadow-elevated)]">
          {toast}
        </div>
      )}
    </div>
  );
}
