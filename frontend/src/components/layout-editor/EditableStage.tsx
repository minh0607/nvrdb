import { useCallback, useRef } from 'react';
import { api } from '../../lib/api';
import { useImageDimensions } from '../../hooks/useImageDimensions';
import type { LayoutDetail, Placement } from '../../types/api';
import { Camera } from 'lucide-react';

interface EditableStageProps {
  detail: LayoutDetail;
  selectedPlacementId: number | null;
  onSelectPlacement: (id: number) => void;
  /** Fired at drag end with the marker's new position as stage-relative percent. */
  onMovePlacement: (pid: number, x: number, y: number) => void;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * Admin stage: floor-plan background plus camera markers that can be dragged to
 * reposition. Positions are computed as a percentage of the stage bounding rect
 * so they stay correct at any render size.
 */
export function EditableStage({
  detail,
  selectedPlacementId,
  onSelectPlacement,
  onMovePlacement,
}: EditableStageProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pid: number; pointerId: number; moved: boolean; x: number; y: number } | null>(
    null,
  );

  // Versioned image URL so dims refetch after a replacement.
  const imageUrl = detail.has_image ? api.layoutImageUrl(detail.id, detail.updated_at) : null;
  const dims = useImageDimensions(imageUrl);

  const pointToPercent = useCallback((clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: clampPercent(((clientX - rect.left) / rect.width) * 100),
      y: clampPercent(((clientY - rect.top) / rect.height) * 100),
    };
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const pos = pointToPercent(e.clientX, e.clientY);
      if (!pos) return;
      drag.moved = true;
      drag.x = pos.x;
      drag.y = pos.y;
      // Live visual feedback while dragging.
      const el = e.currentTarget;
      el.style.left = `${pos.x}%`;
      el.style.top = `${pos.y}%`;
    },
    [pointToPercent],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>, p: Placement) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pid: p.id, pointerId: e.pointerId, moved: false, x: p.x, y: p.y };
    onSelectPlacement(p.id);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    if (drag.moved) onMovePlacement(drag.pid, drag.x, drag.y);
  };

  return (
    <div className="h-full w-full flex items-center justify-center">
      <div
        ref={stageRef}
        className={`layout-stage max-w-full max-h-full ${detail.has_image ? '' : 'layout-stage--grid'}`}
        style={{ aspectRatio: dims ? `${dims.w} / ${dims.h}` : '16 / 9' }}
      >
        {detail.has_image && imageUrl && (
          <img
            src={imageUrl}
            alt={detail.name}
            className="absolute inset-0 w-full h-full object-fill select-none pointer-events-none"
            draggable={false}
          />
        )}

        {detail.placements.map((p) => {
          const label = p.label?.trim() || `CH${p.channel}`;
          return (
            <button
              key={p.id}
              type="button"
              className={`cam-marker cam-marker--draggable ${
                p.id === selectedPlacementId ? 'cam-marker--selected' : ''
              }`}
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
              onPointerDown={(e) => handlePointerDown(e, p)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              title={label}
            >
              <Camera className="w-3.5 h-3.5" />
              <span className="max-w-[140px] truncate">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
