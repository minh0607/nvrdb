import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Area, PublicNvr } from '../../types/api';
import { MonitorPlay, Map, Settings, ChevronDown, ChevronRight, Video } from 'lucide-react';

interface ZoneGroup {
  key: string;
  name: string;
  nvrs: PublicNvr[];
}

interface ZoneSidebarProps {
  areas: Area[];
  nvrs: PublicNvr[];
  selectedNvrId: number | null;
  onSelectNvr: (id: number) => void;
}

const UNGROUPED_KEY = 'ungrouped';

/**
 * Group NVRs by area, in area sort order, with a trailing "Ungrouped" group for
 * NVRs whose `area_id` is null. Empty areas are kept so admins see every zone,
 * but the Ungrouped group is only included when it actually has members.
 */
export function groupNvrsByArea(areas: Area[], nvrs: PublicNvr[]): ZoneGroup[] {
  const groups: ZoneGroup[] = areas.map((area) => ({
    key: `area-${area.id}`,
    name: area.name,
    nvrs: nvrs.filter((n) => n.area_id === area.id),
  }));

  const ungrouped = nvrs.filter((n) => n.area_id === null);
  if (ungrouped.length > 0) {
    groups.push({ key: UNGROUPED_KEY, name: 'Ungrouped', nvrs: ungrouped });
  }
  return groups;
}

/** Key of the group that contains the given NVR, or null if none matches. */
function groupKeyForNvr(groups: ZoneGroup[], nvrId: number | null): string | null {
  if (nvrId === null) return null;
  return groups.find((g) => g.nvrs.some((n) => n.id === nvrId))?.key ?? null;
}

/**
 * Left sidebar for the Live View: a compact, scrollable list of NVRs grouped
 * into collapsible zone (area) sections. Clicking an NVR selects it. The group
 * holding the selected NVR is always kept expanded.
 */
export function ZoneSidebar({ areas, nvrs, selectedNvrId, onSelectNvr }: ZoneSidebarProps) {
  const groups = useMemo(() => groupNvrsByArea(areas, nvrs), [areas, nvrs]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Always keep the group containing the current selection expanded (and expand
  // it on the initial default selection).
  useEffect(() => {
    const key = groupKeyForNvr(groups, selectedNvrId);
    if (!key) return;
    setExpanded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, [groups, selectedNvrId]);

  const toggle = (key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <aside className="w-60 flex-shrink-0 h-full flex flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-[var(--color-accent)]/10">
            <MonitorPlay className="w-4 h-4 text-[var(--color-accent)]" />
          </div>
          <h1 className="text-sm font-bold tracking-tight truncate">Live View</h1>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Link
            to="/map"
            title="Map"
            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-raised)] transition-colors"
          >
            <Map className="w-4 h-4" />
          </Link>
          <Link
            to="/admin"
            title="Admin"
            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-raised)] transition-colors"
          >
            <Settings className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Grouped NVR list */}
      <div className="flex-1 overflow-y-auto py-1">
        {groups.map((group) => {
          const isOpen = expanded.has(group.key);
          return (
            <div key={group.key}>
              <button
                onClick={() => toggle(group.key)}
                className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] transition-colors"
              >
                {isOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
                )}
                <span className="flex-1 truncate text-xs font-semibold uppercase tracking-wider">
                  {group.name}
                </span>
                <span className="text-[10px] font-mono text-[var(--color-text-dim)]">
                  {group.nvrs.length}
                </span>
              </button>

              {isOpen &&
                group.nvrs.map((nvr) => {
                  const active = nvr.id === selectedNvrId;
                  return (
                    <button
                      key={nvr.id}
                      onClick={() => onSelectNvr(nvr.id)}
                      className={`w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-left transition-colors ${
                        active
                          ? 'bg-[var(--color-accent-soft)] text-[var(--color-text)]'
                          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)]'
                      }`}
                    >
                      <Video
                        className={`w-3.5 h-3.5 flex-shrink-0 ${
                          active ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-dim)]'
                        }`}
                      />
                      <span className="flex-1 truncate text-sm">{nvr.name}</span>
                      <span className="text-[10px] font-mono text-[var(--color-text-dim)]">
                        {nvr.max_channels}ch
                      </span>
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
