import { api } from '../../lib/api';
import { X, Download } from 'lucide-react';

interface VlcHelpModalProps {
  onClose: () => void;
}

/** Trigger a browser download of the VLC setup script. */
function downloadVlcSetup(): void {
  const a = document.createElement('a');
  a.href = api.vlcSetupUrl();
  a.download = 'setup-vlc-rtsp.ps1';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Modal explaining how to enable the "Open in VLC" flow, with a button that
 * downloads the one-time setup script.
 */
export function VlcHelpModal({ onClose }: VlcHelpModalProps) {
  return (
    <div
      className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-[var(--shadow-elevated)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h3 className="text-base font-semibold">Enable &apos;Open in VLC&apos;</h3>
          <button
            onClick={onClose}
            className="p-1 -mr-1 text-[var(--color-text-dim)] hover:text-[var(--color-text)] rounded transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
            For cameras set to VLC mode: download this script and run it as Administrator once on
            this PC. It installs VLC and lets rtsp links open in VLC without a prompt.
          </p>
          <button
            onClick={downloadVlcSetup}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-lg transition-colors"
          >
            <Download className="w-4 h-4" />
            Download setup script
          </button>
        </div>
      </div>
    </div>
  );
}
