import { useState } from 'react';
import { api } from '../../lib/api';
import type { Area } from '../../types/api';
import { Plus, Trash2, Check, X, Pencil, LayoutGrid } from 'lucide-react';

interface AreaManagerProps {
  areas: Area[];
  /** Reload areas (and layouts, since deleting an area ungroups layouts). */
  onAreasChanged: () => void;
}

/**
 * Compact admin bar to create, rename, and delete areas (building zones that
 * group floor-plan layouts). Deleting an area only ungroups its layouts.
 */
export function AreaManager({ areas, onAreasChanged }: AreaManagerProps) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      await api.createArea(name);
      setNewName('');
      onAreasChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create area');
    }
  };

  const startEdit = (area: Area) => {
    setEditingId(area.id);
    setEditDraft(area.name);
    setError(null);
  };

  const handleRename = async (id: number) => {
    const name = editDraft.trim();
    if (!name) return;
    setError(null);
    try {
      await api.updateArea(id, { name });
      setEditingId(null);
      onAreasChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename area');
    }
  };

  const handleDelete = async (area: Area) => {
    if (!window.confirm(`Delete area "${area.name}"? Its layouts will be ungrouped.`)) return;
    setError(null);
    try {
      await api.deleteArea(area.id);
      onAreasChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete area');
    }
  };

  return (
    <div className="px-3 py-2.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
          <LayoutGrid className="w-3.5 h-3.5" />
          Areas
        </span>

        {areas.map((area) =>
          editingId === area.id ? (
            <div key={area.id} className="inline-flex items-center gap-1">
              <input
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRename(area.id)}
                autoFocus
                className="w-28 px-2 py-1 text-xs bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded focus:outline-none focus:border-[var(--color-accent)]"
              />
              <button
                onClick={() => handleRename(area.id)}
                className="p-1 text-[var(--color-success)] hover:bg-[var(--color-surface-raised)] rounded"
                title="Save"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setEditingId(null)}
                className="p-1 text-[var(--color-text-dim)] hover:text-red-400 rounded"
                title="Cancel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <span
              key={area.id}
              className="group inline-flex items-center gap-1 pl-2.5 pr-1 py-1 text-xs font-medium rounded-full bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]"
            >
              {area.name}
              <button
                onClick={() => startEdit(area)}
                className="p-0.5 text-[var(--color-text-dim)] hover:text-[var(--color-accent)] opacity-0 group-hover:opacity-100 transition-opacity"
                title="Rename area"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={() => handleDelete(area)}
                className="p-0.5 text-[var(--color-text-dim)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete area"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </span>
          ),
        )}

        <div className="inline-flex items-center gap-1 ml-auto">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="New area…"
            className="w-32 px-2 py-1 text-xs bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded focus:outline-none focus:border-[var(--color-accent)]"
          />
          <button
            onClick={handleCreate}
            className="p-1.5 text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded transition-colors"
            title="Add area"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {error && <p className="mt-1.5 text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
