import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { AllowedIp } from '../../types/api';
import { Shield, Plus, Trash2, Loader2, AlertTriangle, Info, Save } from 'lucide-react';

/**
 * Admin page to manage the IP allowlist that gates access to the whole web app.
 * An empty list means the site is open to everyone; once at least one IP exists,
 * only listed IPs (and localhost on the server) can reach the app.
 */
export function AccessControl() {
  const [ips, setIps] = useState<AllowedIp[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [ipDraft, setIpDraft] = useState('');
  const [labelDraft, setLabelDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // VLC installer URL setting.
  const [vlcUrlDraft, setVlcUrlDraft] = useState('');
  const [savingVlcUrl, setSavingVlcUrl] = useState(false);
  const [vlcUrlError, setVlcUrlError] = useState<string | null>(null);
  const [vlcUrlSaved, setVlcUrlSaved] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    setLoadError(null);
    try {
      const list = await api.listAllowedIps();
      setIps(list);
      setStatus('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load IP list');
      setStatus('error');
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const settings = await api.getSettings();
      setVlcUrlDraft(settings.vlc_download_url ?? '');
    } catch {
      // Non-fatal: leave the field blank if settings can't be loaded.
    }
  }, []);

  useEffect(() => {
    load();
    loadSettings();
  }, [load, loadSettings]);

  const handleSaveVlcUrl = async () => {
    setSavingVlcUrl(true);
    setVlcUrlError(null);
    setVlcUrlSaved(false);
    try {
      const settings = await api.updateSettings({ vlc_download_url: vlcUrlDraft.trim() });
      setVlcUrlDraft(settings.vlc_download_url ?? '');
      setVlcUrlSaved(true);
    } catch (err) {
      setVlcUrlError(err instanceof Error ? err.message : 'Could not save VLC installer URL');
    } finally {
      setSavingVlcUrl(false);
    }
  };

  const handleAdd = async () => {
    const ip = ipDraft.trim();
    const label = labelDraft.trim();
    if (!ip) {
      setFormError('Please enter an IP address or CIDR range');
      return;
    }
    setAdding(true);
    setFormError(null);
    try {
      await api.addAllowedIp(ip, label === '' ? undefined : label);
      setIpDraft('');
      setLabelDraft('');
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not add IP');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    setFormError(null);
    try {
      await api.deleteAllowedIp(id);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not delete IP');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="p-1.5 rounded-lg bg-[var(--color-accent)]/10">
          <Shield className="w-5 h-5 text-[var(--color-accent)]" />
        </div>
        <div>
          <h1 className="text-lg font-bold">IP Restrictions</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            {ips.length} IP{ips.length !== 1 ? 's' : ''} allowed to access
          </p>
        </div>
      </div>

      {/* Warning note */}
      <div className="mb-5 flex gap-3 px-4 py-3 text-xs leading-relaxed text-[var(--color-warning)] bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/25 rounded-lg">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p>
          <strong>An empty list = OPEN to everyone.</strong> Once at least one IP exists, only IPs
          in the list (and localhost on the server) can reach the web app. If you lock yourself out,
          manage it again from a browser <strong>directly ON the server (localhost)</strong>. CIDR
          ranges such as <span className="font-mono">192.168.1.0/24</span> are also accepted.
        </p>
      </div>

      {/* Add form */}
      <div className="mb-5 p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            value={ipDraft}
            onChange={(e) => setIpDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="IP or CIDR (e.g. 192.168.1.10 or 192.168.1.0/24)"
            className="flex-1 min-w-0 px-3 py-2 text-sm font-mono bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-accent)]"
          />
          <input
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Label (optional)"
            className="sm:w-44 px-3 py-2 text-sm bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-accent)]"
          />
          <button
            onClick={handleAdd}
            disabled={adding}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-lg transition-colors disabled:opacity-50"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </button>
        </div>
        {formError && <p className="mt-2 text-xs text-red-400">{formError}</p>}
      </div>

      {/* VLC installer URL setting */}
      <div className="mb-5 p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg">
        <label
          htmlFor="vlc-url"
          className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-dim)] mb-2"
        >
          VLC installer URL
        </label>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            id="vlc-url"
            value={vlcUrlDraft}
            onChange={(e) => {
              setVlcUrlDraft(e.target.value);
              setVlcUrlSaved(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveVlcUrl()}
            placeholder="https://…/vlc-installer.exe"
            className="flex-1 min-w-0 px-3 py-2 text-sm font-mono bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-accent)]"
          />
          <button
            onClick={handleSaveVlcUrl}
            disabled={savingVlcUrl}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-lg transition-colors disabled:opacity-50"
          >
            {savingVlcUrl ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
        <p className="mt-2 text-[11px] text-[var(--color-text-dim)]">
          URL to the VLC installer .exe (used by the setup script the "?" button downloads).
        </p>
        {vlcUrlError && <p className="mt-1 text-xs text-red-400">{vlcUrlError}</p>}
        {vlcUrlSaved && !vlcUrlError && (
          <p className="mt-1 text-xs text-[var(--color-success)]">Saved.</p>
        )}
      </div>

      {/* States */}
      {status === 'loading' && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-[var(--color-text-dim)]">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent)]" />
          <span className="text-sm">Loading…</span>
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <AlertTriangle className="w-7 h-7 text-red-400" />
          <p className="text-sm text-red-300">{loadError}</p>
        </div>
      )}

      {status === 'ready' && ips.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="p-4 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] mb-4">
            <Shield className="w-9 h-9 text-[var(--color-text-dim)]" />
          </div>
          <h2 className="text-base font-semibold mb-1">No IP restrictions yet</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            The web app is open to everyone. Add an IP to start restricting access.
          </p>
        </div>
      )}

      {status === 'ready' && ips.length > 0 && (
        <div className="overflow-hidden bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)] border-b border-[var(--color-border-subtle)]">
                <th className="px-4 py-2.5 font-semibold">IP / CIDR</th>
                <th className="px-4 py-2.5 font-semibold">Label</th>
                <th className="px-4 py-2.5 font-semibold">Added at</th>
                <th className="px-4 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody>
              {ips.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-surface-raised)] transition-colors"
                >
                  <td className="px-4 py-2.5 font-mono text-xs">{entry.ip}</td>
                  <td className="px-4 py-2.5 text-[var(--color-text-muted)]">
                    {entry.label?.trim() || <span className="text-[var(--color-text-dim)]">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--color-text-dim)]">
                    {new Date(entry.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => handleDelete(entry.id)}
                      disabled={deletingId === entry.id}
                      className="p-1.5 text-[var(--color-text-dim)] hover:text-red-400 rounded transition-colors disabled:opacity-40"
                      title="Delete"
                    >
                      {deletingId === entry.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
