import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import {
  Map,
  MonitorPlay,
  History,
  Server,
  LogOut,
  Shield,
  Lock,
  Activity,
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/admin', icon: Map, label: 'Layouts' },
  { to: '/admin/live', icon: MonitorPlay, label: 'Live View' },
  { to: '/admin/playback', icon: History, label: 'Playback' },
  { to: '/admin/devices', icon: Server, label: 'Devices' },
  { to: '/admin/access', icon: Lock, label: 'IP Restrictions' },
];

export function Sidebar() {
  const navigate = useNavigate();
  const { username, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside className="w-56 flex flex-col bg-[var(--color-surface)] border-r border-[var(--color-border)]">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-[var(--color-border)]">
        <div className="p-1.5 rounded-lg bg-[var(--color-accent)]/10">
          <Shield className="w-5 h-5 text-[var(--color-accent)]" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-tight">NVR Dashboard</h1>
          <p className="text-[10px] text-[var(--color-text-dim)]">Hanwha VMS · v{__APP_VERSION__}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-3 space-y-1">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/admin'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-[var(--color-accent)] text-white shadow-sm shadow-[var(--color-accent)]/20'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-raised)]'
              }`
            }
          >
            <Icon className="w-4 h-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* System status indicator */}
      <div className="px-4 py-3 mx-3 mb-3 rounded-lg bg-[var(--color-surface-raised)]">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="w-3 h-3 text-[var(--color-success)]" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
            System
          </span>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">go2rtc connected</p>
      </div>

      {/* User / Logout */}
      <div className="flex items-center justify-between px-5 py-4 border-t border-[var(--color-border)]">
        <div className="min-w-0">
          <p className="text-xs font-medium truncate">{username ?? 'User'}</p>
          <p className="text-[10px] text-[var(--color-text-dim)]">Administrator</p>
        </div>
        <button
          onClick={handleLogout}
          className="p-2 text-[var(--color-text-dim)] hover:text-red-400 rounded-md hover:bg-red-500/10 transition-colors"
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}
