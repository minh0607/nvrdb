import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { CameraSourcePanel } from '../../components/layout-editor/CameraSourcePanel';
import { EditableStage } from '../../components/layout-editor/EditableStage';
import type { Layout, LayoutDetail } from '../../types/api';
import { Plus, Trash2, Upload, Map, ImageIcon, Loader2, Save } from 'lucide-react';

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/**
 * Admin floor-plan editor: manage layouts, upload floor-plan images, and place
 * camera markers by dragging them on the stage.
 */
export function LayoutManager() {
  const [layouts, setLayouts] = useState<Layout[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<LayoutDetail | null>(null);
  const [selectedPlacementId, setSelectedPlacementId] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [labelDraft, setLabelDraft] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadLayouts = useCallback(async () => {
    try {
      const list = await api.listLayouts();
      setLayouts(list);
      setSelectedId((prev) => prev ?? list[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách sơ đồ');
    }
  }, []);

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
      setError(err instanceof Error ? err.message : 'Không thể tải sơ đồ');
    }
  }, []);

  useEffect(() => {
    loadLayouts();
  }, [loadLayouts]);

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
      setError(err instanceof Error ? err.message : 'Không thể tạo sơ đồ');
    }
  };

  const handleDeleteLayout = async (id: number) => {
    try {
      await api.deleteLayout(id);
      if (selectedId === id) setSelectedId(null);
      await loadLayouts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa sơ đồ');
    }
  };

  const handleUpload = async (file: File) => {
    if (selectedId === null) return;
    setError(null);
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setError('Chỉ hỗ trợ PNG, JPEG, WEBP, GIF');
      return;
    }
    setUploading(true);
    try {
      await api.uploadLayoutImage(selectedId, file);
      await loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tải ảnh thất bại');
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
      setError(err instanceof Error ? err.message : 'Không thể thêm camera');
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
      setError(err instanceof Error ? err.message : 'Không thể cập nhật vị trí');
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
      setError(err instanceof Error ? err.message : 'Không thể cập nhật nhãn');
    }
  };

  const handleDeletePlacement = async () => {
    if (selectedId === null || selectedPlacementId === null) return;
    setError(null);
    try {
      await api.deletePlacement(selectedId, selectedPlacementId);
      setSelectedPlacementId(null);
      await loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa camera');
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
            Sơ đồ
          </h1>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--color-border-subtle)]">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Tên sơ đồ mới…"
            className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded focus:outline-none focus:border-[var(--color-accent)]"
          />
          <button
            onClick={handleCreate}
            className="p-1.5 text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded transition-colors"
            title="Tạo sơ đồ"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {layouts.map((l) => (
            <div
              key={l.id}
              className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                l.id === selectedId
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)]'
              }`}
              onClick={() => setSelectedId(l.id)}
            >
              <span className="flex-1 truncate text-sm">{l.name}</span>
              {l.has_image && <ImageIcon className="w-3 h-3 text-[var(--color-text-dim)]" />}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteLayout(l.id);
                }}
                className="p-0.5 text-[var(--color-text-dim)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Xóa"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Center: stage + toolbar */}
      <main className="flex-1 min-w-0 flex flex-col p-4 gap-3">
        {error && (
          <div className="px-4 py-2.5 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg">
            {error}
          </div>
        )}

        {selectedId === null || !detail ? (
          <div className="flex-1 flex items-center justify-center text-center text-[var(--color-text-dim)]">
            <p className="text-sm">Chọn hoặc tạo một sơ đồ để bắt đầu.</p>
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
                {detail.has_image ? 'Đổi ảnh nền' : 'Tải ảnh nền'}
              </button>
              <span className="text-xs text-[var(--color-text-dim)]">
                {detail.placements.length} camera · click camera bên phải để thêm, kéo để di chuyển
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
                  placeholder="Nhãn hiển thị…"
                  className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded focus:outline-none focus:border-[var(--color-accent)]"
                />
                <button
                  onClick={handleSaveLabel}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded transition-colors"
                >
                  <Save className="w-3.5 h-3.5" />
                  Lưu
                </button>
                <button
                  onClick={handleDeletePlacement}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Xóa
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
