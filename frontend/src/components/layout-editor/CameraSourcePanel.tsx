import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useNvrStore } from '../../stores/nvr.store';
import type { Camera } from '../../types/api';
import { ChevronDown, ChevronRight, Plus, Link2, Check, X, Pencil } from 'lucide-react';

interface CameraSourcePanelProps {
  /** Add a camera to the current layout at the stage center. */
  onAddCamera: (nvrId: number, channel: number, label: string) => void;
}

/**
 * Source list of NVRs and their cameras. Expand an NVR to reveal cameras; click
 * a camera (or its + button) to drop a marker on the layout. Each camera also
 * exposes an inline RTSP-override editor.
 */
export function CameraSourcePanel({ onAddCamera }: CameraSourcePanelProps) {
  const { nvrs, cameras, fetchNvrs, fetchCameras } = useNvrStore();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [overrideDraft, setOverrideDraft] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Inline camera-name editor (parallel to the RTSP-override editor above).
  const [editingNameKey, setEditingNameKey] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [savingNameKey, setSavingNameKey] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (nvrs.length === 0) fetchNvrs();
  }, [nvrs.length, fetchNvrs]);

  const toggle = (nvrId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nvrId)) {
        next.delete(nvrId);
      } else {
        next.add(nvrId);
        if (!cameras.get(nvrId)) fetchCameras(nvrId);
      }
      return next;
    });
  };

  const keyFor = (nvrId: number, channel: number) => `${nvrId}:${channel}`;

  const startEditOverride = (cam: Camera) => {
    setEditingKey(keyFor(cam.nvr_id, cam.channel));
    setOverrideDraft(cam.rtsp_override ?? '');
    setSaveError(null);
  };

  const saveOverride = async (cam: Camera) => {
    const key = keyFor(cam.nvr_id, cam.channel);
    setSavingKey(key);
    setSaveError(null);
    try {
      const trimmed = overrideDraft.trim();
      await api.updateCamera(cam.nvr_id, cam.channel, {
        rtsp_override: trimmed === '' ? null : trimmed,
      });
      await fetchCameras(cam.nvr_id); // refresh so the stored value reflects the edit
      setEditingKey(null);
    } catch (err) {
      // Keep the editor open on failure and surface the reason inline.
      setSaveError(err instanceof Error ? err.message : 'Could not save RTSP override');
    } finally {
      setSavingKey(null);
    }
  };

  const startEditName = (cam: Camera) => {
    setEditingNameKey(keyFor(cam.nvr_id, cam.channel));
    setNameDraft(cam.name);
    setNameError(null);
  };

  const saveName = async (cam: Camera) => {
    const key = keyFor(cam.nvr_id, cam.channel);
    const trimmed = nameDraft.trim();
    if (trimmed === '') {
      setNameError('Camera name cannot be empty');
      return;
    }
    setSavingNameKey(key);
    setNameError(null);
    try {
      await api.updateCamera(cam.nvr_id, cam.channel, { name: trimmed });
      await fetchCameras(cam.nvr_id); // refresh so the stored name reflects the edit
      setEditingNameKey(null);
    } catch (err) {
      // Keep the editor open on failure and surface the reason inline.
      setNameError(err instanceof Error ? err.message : 'Could not save camera name');
    } finally {
      setSavingNameKey(null);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <h3 className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)] border-b border-[var(--color-border-subtle)]">
        Camera Sources
      </h3>
      <div className="flex-1 overflow-y-auto">
        {nvrs.length === 0 && (
          <p className="px-3 py-4 text-xs text-[var(--color-text-dim)]">No NVRs yet.</p>
        )}
        {nvrs.map((nvr) => {
          const isOpen = expanded.has(nvr.id);
          const cams = cameras.get(nvr.id) ?? [];
          return (
            <div key={nvr.id} className="border-b border-[var(--color-border-subtle)]">
              <button
                onClick={() => toggle(nvr.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--color-surface-raised)] transition-colors"
              >
                {isOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-[var(--color-text-dim)]" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-[var(--color-text-dim)]" />
                )}
                <span className="truncate font-medium">{nvr.name}</span>
                <span className="ml-auto font-mono text-[10px] text-[var(--color-text-dim)]">
                  {nvr.ip}
                </span>
              </button>

              {isOpen && (
                <div className="pb-1">
                  {cams.length === 0 && (
                    <p className="px-8 py-2 text-[11px] text-[var(--color-text-dim)]">
                      No cameras yet.
                    </p>
                  )}
                  {cams.map((cam) => {
                    const key = keyFor(cam.nvr_id, cam.channel);
                    const isEditing = editingKey === key;
                    const isEditingName = editingNameKey === key;
                    return (
                      <div key={cam.id} className="pl-8 pr-2">
                        <div className="flex items-center gap-2 py-1 group">
                          <button
                            onClick={() => onAddCamera(cam.nvr_id, cam.channel, cam.name)}
                            className="flex-1 flex items-center gap-2 min-w-0 text-left text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                            title="Add to layout"
                          >
                            <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                              CH{cam.channel}
                            </span>
                            <span className="truncate">{cam.name}</span>
                            {cam.rtsp_override && (
                              <Link2 className="w-3 h-3 text-[var(--color-accent)] flex-shrink-0" />
                            )}
                          </button>
                          <button
                            onClick={() => startEditName(cam)}
                            className="p-1 text-[var(--color-text-dim)] hover:text-[var(--color-accent)] opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Rename camera"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => startEditOverride(cam)}
                            className="p-1 text-[var(--color-text-dim)] hover:text-[var(--color-accent)] opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Edit RTSP override"
                          >
                            <Link2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onAddCamera(cam.nvr_id, cam.channel, cam.name)}
                            className="p-1 text-[var(--color-text-dim)] hover:text-[var(--color-accent)] transition-colors"
                            title="Add to layout"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {isEditingName && (
                          <div className="flex items-center gap-1.5 pb-2 pt-0.5">
                            <input
                              value={nameDraft}
                              onChange={(e) => setNameDraft(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && saveName(cam)}
                              placeholder="Camera name…"
                              className="flex-1 min-w-0 px-2 py-1 text-[11px] bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded focus:outline-none focus:border-[var(--color-accent)]"
                            />
                            <button
                              onClick={() => saveName(cam)}
                              disabled={savingNameKey === key}
                              className="p-1 text-[var(--color-success)] hover:bg-[var(--color-surface-raised)] rounded disabled:opacity-40"
                              title="Save"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setEditingNameKey(null)}
                              className="p-1 text-[var(--color-text-dim)] hover:text-red-400 rounded"
                              title="Cancel"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        {isEditingName && nameError && (
                          <p className="pb-2 text-[10px] text-red-400">{nameError}</p>
                        )}

                        {isEditing && (
                          <div className="flex items-center gap-1.5 pb-2 pt-0.5">
                            <input
                              value={overrideDraft}
                              onChange={(e) => setOverrideDraft(e.target.value)}
                              placeholder="rtsp://…  (blank = default)"
                              className="flex-1 min-w-0 px-2 py-1 text-[11px] font-mono bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded focus:outline-none focus:border-[var(--color-accent)]"
                            />
                            <button
                              onClick={() => saveOverride(cam)}
                              disabled={savingKey === key}
                              className="p-1 text-[var(--color-success)] hover:bg-[var(--color-surface-raised)] rounded disabled:opacity-40"
                              title="Save"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setEditingKey(null)}
                              className="p-1 text-[var(--color-text-dim)] hover:text-red-400 rounded"
                              title="Cancel"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        {isEditing && saveError && (
                          <p className="pb-2 text-[10px] text-red-400">{saveError}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
