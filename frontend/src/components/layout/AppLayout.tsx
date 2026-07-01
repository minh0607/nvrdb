import { Outlet, Navigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useAuthStore } from '../../stores/auth.store';

export function AppLayout() {
  const { isAuthenticated, role } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // The admin area is admin-only; authenticated non-admins go to the public viewer.
  if (role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-[var(--color-bg)]">
        <Outlet />
      </main>
    </div>
  );
}
