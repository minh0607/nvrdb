import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { CameraSourcePanel } from '../../components/layout-editor/CameraSourcePanel';
import { EditableStage } from '../../components/layout-editor/EditableStage';
import { AreaManager } from '../../components/layout-editor/AreaManager';
import type { Area, Layout, LayoutDetail, ViewMode } from '../../types/api';
import { Plus, Trash2, Upload, Map, ImageIcon, Loader2, Save } from 'lucide-react';

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// Per-placement view-mode options. `null` means "inherit the global default".
const PLACEMENT_MODE_OPTIONS: { value: ViewMode | null; label: string }[] = [
  { value: null, label: 'Default' },
  { value: 'go2rtc', label: 'go2rtc' },
  { value: 'vlc', label: 'VLC' },
];

/**
 * Admin floor-plan editor: manage layouts, upload floor-plan images, and place
 * camera markers by dragging them on the stage.
 */
export function LayoutManager() {
  const [layouts, setLayouts] = useState<Layout[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<LayoutDetail | null>(null);
  const [selectedPlacementId, setSelectedPlacementId] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [labelDraft, setLabelDraft] = useState('');
  // Frame-aspect editor drafts (blank = null → derive from image / 16:9).
  const [widthDraft, setWidthDraft] = useState('');
  const [heightDraft, setHeightDraft] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultViewMode, setDefaultViewMode] = useState<ViewMode>('go2rtc');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadLayouts = useCallback(async () => {
    try {
      const list = await api.listLayouts();
      setLayouts(list);
      setSelectedId((prev) => prev ?? list[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load layouts');
    }
  }, []);

  const loadAreas = useCallback(async () => {
    try {
      setAreas(await api.listAreas());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load areas');
    }
  }, []);

  // Reload areas and layouts together after an area change (delete ungroups).
  const handleAreasChanged = useCallback(() => {
    void loadAreas();
    void loadLayouts();
  }, [loadAreas, loadLayouts]);

  // Guards against out-of-order responses: a slow load for a previously-selected
  // layout must not overwrite the detail for the current selection.
  const detailReqRef = useRef(0);
  const loadDetail = useCallback(async (id: number) => {
    const req = ++detailReqRef.current;
    try {
      const d = await api.getLayout(id);
      if (req !== detailReqRef.current) return;
      setDetail(d);
    } catch (err) {
      if (req !== detailReqRef.current) return;
      setError(err instanceof Error ? err.message : 'Could not load layout');
    }
  }, []);

  useEffect(() => {
    loadLayouts();
    loadAreas();
  }, [loadLayouts, loadAreas]);

  // Load the global default view mode once.
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

  useEffect(() => {
    setSelectedPlacementId(null);
    if (selectedId !== null) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  // Keep the label editor in sync with the selected placement.
  useEffect(() => {
    const p = detail?.placements.find((pl) => pl.id === selectedPlacementId);
    setLabelDraft(p?.label ?? '');
  }, [selectedPlacementId, detail]);

  // Keep the size editor in sync with the loaded layout (blank when unset).
  useEffect(() => {
    setWidthDraft(detail?.width != null ? String(detail.width) : '');
    setHeightDraft(detail?.height != null ? String(detail.height) : '');
  }, [detail]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      const created = await api.createLayout(name);
      setNewName('');
      await loadLayouts();
      setSelectedId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create layout');
    }
  };

  const handleDeleteLayout = async (id: number) => {
    try {
      await api.deleteLayout(id);
      if (selectedId === id) setSelectedId(null);
      await loadLayouts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete layout');
    }
  };

  const handleChangeArea = async (id: number, areaId: number | null) => {
    setError(null);
    try {
      await api.updateLayout(id, { area_id: areaId });
      await loadLayouts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change area');
    }
  };

  const handleUpload = async (file: File) => {
    if (selectedId === null) return;
    setError(null);
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setError('Only PNG, JPEG, WEBP, and GIF are supported');
      return;
    }
    setUploading(true);
    try {
      await api.uploadLayoutImage(selectedId, file);
      await loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleAddCamera = async (nvrId: number, channel: number, label: string) => {
    if (selectedId === null) return;
    setError(null);
    try {
      await api.addPlacement(selectedId, { nvr_id: nvrId, channel, label, x: 50, y: 50 });
      await loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add camera');
    }
  };

  const handleMovePlacement = async (pid: number, x: number, y: number) => {
    if (selectedId === null) return;
    setError(null);
    // Optimistic update so the marker doesn't snap back before the reload.
    setDetail((prev) =>
      prev ? { ...prev, placements: prev.placements.map((p) => (p.id === pid ? { ...p, x, y } : p)) } : prev,
    );
    try {
      await api.updatePlacement(selectedId, pid, { x, y });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update position');
      loadDetail(selectedId); // reconcile on failure
    }
  };

  const handleSaveLabel = async () => {
    if (selectedId === null || selectedPlacementId === null) return;
    setError(null);
    try {
      await api.updatePlacement(selectedId, selectedPlacementId, { label: labelDraft.trim() });
      await loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update label');
    }
  };

  const applySize = async (width: number | null, height: number | null) => {
    if (selectedId === null) return;
    setError(null);
    try {
      await api.updateLayout(selectedId, { width, height });
      await loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update size');
    }
  };

  const parseDim = (value: string): number | null => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isInteger(n) && n >= 1 && n <= 20000 ? n : NaN;
  };

  const handleApplySize = async () => {
    const width = parseDim(widthDraft);
    const height = parseDim(heightDraft);
    if (Number.isNaN(width) || Number.isNaN(height)) {
      setError('Size must be a whole number from 1 to 20000 (or left blank)');
      return;
    }
    // Both blank clears the aspect; otherwise both must be provided.
    if ((width === null) !== (height === null)) {
      setError('Enter both Width and Height, or leave both blank');
      return;
    }
    await applySize(width, height);
  };

  const handleDeletePlacement = async () => {
    if (selectedId === null || selectedPlacementId === null) return;
    setError(null);
    try {
      await api.deletePlacement(selectedId, selectedPlacementId);
      setSelectedPlacementId(null);
      await loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete camera');
    }
  };

  const handleChangeDefaultMode = async (mode: ViewMode) => {
    const prev = defaultViewMode;
    setDefaultViewMode(mode); // optimistic
    setError(null);
    try {
      const settings = await api.updateSettings({ default_view_mode: mode });
      setDefaultViewMode(settings.default_view_mode);
    } catch (err) {
      setDefaultViewMode(prev); // revert on failure
      setError(err instanceof Error ? err.message : 'Could not save default view mode');
    }
  };

  const handleChangePlacementMode = async (mode: ViewMode | null) => {
    if (selectedId === null || selectedPlacementId === null) return;
    setError(null);
    // Optimistic local update so the selector reflects the choice immediately.
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            placements: prev.placements.map((p) =>
              p.id === selectedPlacementId ? { ...p, view_mode: mode } : p,
            ),
          }
        : prev,
    );
    try {
      await api.updatePlacement(selectedId, selectedPlacementId, { view_mode: mode });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update view mode');
      loadDetail(selectedId); // reconcile on failure
    }
  };

  const selectedPlacement = detail?.placements.find((p) => p.id === selectedPlacementId) ?? null;

  return (
    <div className="h-full flex">
      {/* Left: layout list */}
      <aside className="w-56 flex-shrink-0 flex flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="px-4 py-4 border-b border-[var(--color-border)]">
          <h1 className="text-sm font-bold flex items-center gap-2">
            <Map className="w-4 h-4 text-[var(--color-accent)]" />
            Layouts
          </h1>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--color-border-subtle)]">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="New layout name…"
            className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded focus:outline-none focus:border-[var(--color-accent)]"
          />
          <button
            onClick={handleCreate}
            className="p-1.5 text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded transition-colors"
            title="Create layout"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {layouts.map((l) => (
            <div
              key={l.id}
              className={`group px-3 py-2 cursor-pointer transition-colors ${
                l.id === selectedId
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)]'
              }`}
              onClick={() => setSelectedId(l.id)}
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm">{l.name}</span>
                {l.has_image && <ImageIcon className="w-3 h-3 text-[var(--color-text-dim)]" />}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteLayout(l.id);
                  }}
                  className="p-0.5 text-[var(--color-text-dim)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {areas.length > 0 && (
                <select
                  value={l.area_id ?? ''}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    handleChangeArea(l.id, e.target.value === '' ? null : Number(e.target.value))
                  }
                  className="mt-1 w-full px-1.5 py-1 text-[11px] bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded focus:outline-none focus:border-[var(--color-accent)] cursor-pointer"
                  title="Area"
                >
                  <option value="">General</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>
      </aside>

      {/* Center: stage + toolbar */}
      <main className="flex-1 min-w-0 flex flex-col p-4 gap-3">
        <AreaManager areas={areas} onAreasChanged={handleAreasChanged} />

        {error && (
          <div className="px-4 py-2.5 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg">
            {error}
          </div>
        )}

        {selectedId === null || !detail ? (
          <div className="flex-1 flex items-center justify-center text-center text-[var(--color-text-dim)]">
            <p className="text-sm">Select or create a layout to get started.</p>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-lg transition-colors disabled:opacity-50"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {detail.has_image ? 'Change background' : 'Upload background'}
              </button>
              <span className="text-xs text-[var(--color-text-dim)]">
                {detail.placements.length} cameras · click a camera on the right to add, drag to move
              </span>

              {/* Global default view mode */}
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-[var(--color-text-dim)]">Default view mode</span>
                <div className="inline-flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-0.5">
                  {(['go2rtc', 'vlc'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => handleChangeDefaultMode(mode)}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        defaultViewMode === mode
                          ? 'bg-[var(--color-accent)] text-white'
                          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                      }`}
                    >
                      {mode === 'vlc' ? 'VLC' : 'go2rtc'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Layout size (frame aspect) */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-[var(--color-text-dim)]">Layout size</span>
              <input
                type="number"
                min={1}
                max={20000}
                value={widthDraft}
                onChange={(e) => setWidthDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApplySize()}
                placeholder="Width"
                className="w-20 px-2 py-1.5 text-xs bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded focus:outline-none focus:border-[var(--color-accent)]"
              />
              <span className="text-xs text-[var(--color-text-dim)]">×</span>
              <input
                type="number"
                min={1}
                max={20000}
                value={heightDraft}
                onChange={(e) => setHeightDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApplySize()}
                placeholder="Height"
                className="w-20 px-2 py-1.5 text-xs bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded focus:outline-none focus:border-[var(--color-accent)]"
              />
              <button
                onClick={handleApplySize}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                Apply
              </button>
              <div className="inline-flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-0.5">
                {(
                  [
                    ['16:9', 1600, 900],
                    ['4:3', 1200, 900],
                    ['1:1', 1000, 1000],
                  ] as const
                ).map(([label, w, h]) => (
                  <button
                    key={label}
                    onClick={() => {
                      setWidthDraft(String(w));
                      setHeightDraft(String(h));
                      void applySize(w, h);
                    }}
                    className="px-2.5 py-1 text-[11px] font-medium rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-[var(--color-text-dim)]">
                blank = follow image / 16:9
              </span>
            </div>

            {/* Stage */}
            <div className="flex-1 min-h-0">
              <EditableStage
                detail={detail}
                selectedPlacementId={selectedPlacementId}
                onSelectPlacement={setSelectedPlacementId}
                onMovePlacement={handleMovePlacement}
              />
            </div>

            {/* Selected placement editor */}
            {selectedPlacement && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg">
                <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                  NVR{selectedPlacement.nvr_id}·CH{selectedPlacement.channel}
                </span>
                <input
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveLabel()}
                  placeholder="Display label…"
                  className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded focus:outline-none focus:border-[var(--color-accent)]"
                />
                <button
                  onClick={handleSaveLabel}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded transition-colors"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save
                </button>
                {/* Per-placement view-mode override */}
                <div className="flex items-center gap-1.5 pl-1 border-l border-[var(--color-border)]">
                  <span className="text-[10px] text-[var(--color-text-dim)]">Mode</span>
                  <div className="inline-flex rounded bg-[var(--color-surface-raised)] p-0.5">
                    {PLACEMENT_MODE_OPTIONS.map((opt) => {
                      const active = (selectedPlacement.view_mode ?? null) === opt.value;
                      return (
                        <button
                          key={opt.label}
                          onClick={() => handleChangePlacementMode(opt.value)}
                          className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                            active
                              ? 'bg-[var(--color-accent)] text-white'
                              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button
                  onClick={handleDeletePlacement}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Right: camera source */}
      <aside className="w-64 flex-shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)]">
        <CameraSourcePanel onAddCamera={handleAddCamera} />
      </aside>
    </div>
  );
}
