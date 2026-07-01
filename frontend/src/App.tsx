import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { Viewer } from './pages/Viewer';
import { LoginPage } from './pages/LoginPage';
import { LayoutManager } from './pages/admin/LayoutManager';
import { LiveView } from './pages/LiveView';
import { Playback } from './pages/Playback';
import { DeviceManager } from './pages/DeviceManager';

export function App() {
  return (
    <Routes>
      {/* Public floor-plan viewer — no auth, outside AppLayout. */}
      <Route path="/" element={<Viewer />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Admin — guarded by AppLayout. */}
      <Route path="/admin" element={<AppLayout />}>
        <Route index element={<LayoutManager />} />
        <Route path="live" element={<LiveView />} />
        <Route path="playback" element={<Playback />} />
        <Route path="devices" element={<DeviceManager />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
