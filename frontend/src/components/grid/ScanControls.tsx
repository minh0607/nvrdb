import { Play, Pause } from 'lucide-react';

// Auto-sequence ("patrol") interval choices, in seconds. Keeping only one page
// live at a time and cycling on a timer is what keeps the bandwidth-limited
// internet RTSP link stable.
export const SCAN_INTERVAL_OPTIONS = [5, 10, 15, 30] as const;

interface ScanControlsProps {
  scanning: boolean;
  onToggleScan: () => void;
  intervalSec: number;
  onIntervalChange: (sec: number) => void;
  page: number;
  pageCount: number;
}

/**
 * Top-bar scan (auto-sequence) controls: a Scan toggle, an interval select, and
 * a small "Scanning · Page X/N" indicator shown while a patrol is running.
 */
export function ScanControls({
  scanning,
  onToggleScan,
  intervalSec,
  onIntervalChange,
  page,
  pageCount,
}: ScanControlsProps) {
  return (
    <div className="flex items-center gap-2">
      {scanning && pageCount > 1 && (
        <span className="hidden md:inline text-[10px] font-mono text-[var(--color-accent)] whitespace-nowrap">
          Scanning · Page {page}/{pageCount}
        </span>
      )}

      <select
        value={intervalSec}
        onChange={(e) => onIntervalChange(Number(e.target.value))}
        aria-label="Scan interval"
        title="Scan interval"
        className="h-8 rounded-full bg-[var(--color-surface-raised)] px-2.5 text-xs font-medium text-[var(--color-text-muted)] outline-none hover:text-[var(--color-text)] focus:text-[var(--color-text)]"
      >
        {SCAN_INTERVAL_OPTIONS.map((sec) => (
          <option key={sec} value={sec}>
            {sec}s
          </option>
        ))}
      </select>

      <button
        onClick={onToggleScan}
        aria-pressed={scanning}
        title={scanning ? 'Stop scan' : 'Start scan'}
        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium transition-colors ${
          scanning
            ? 'bg-[var(--color-accent)] text-white shadow-sm shadow-[var(--color-accent)]/30'
            : 'text-[var(--color-text-muted)] bg-[var(--color-surface-raised)] hover:text-[var(--color-text)]'
        }`}
      >
        {scanning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        Scan
      </button>
    </div>
  );
}
