// ── API Response Envelope ────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
  };
}

// ── NVR Device ──────────────────────────────────────────

export interface NvrDevice {
  id: number;
  name: string;
  ip: string;
  http_port: number;
  rtsp_port: number;
  model: string;
  max_channels: number;
  stream_profile: number | null;
  status: 'online' | 'offline' | 'error';
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateNvrInput {
  name: string;
  ip: string;
  http_port?: number;
  rtsp_port?: number;
  username: string;
  password: string;
  model?: string;
  max_channels?: number;
  stream_profile?: number | null;
}

// ── Camera ──────────────────────────────────────────────

export interface Camera {
  id: number;
  nvr_id: number;
  channel: number;
  name: string;
  resolution: string;
  codec: string;
  fps: number;
  enabled: number;
  ptz_supported: number;
  rtsp_override: string | null;
  created_at: string;
  updated_at: string;
}

// ── Stream ──────────────────────────────────────────────

export interface StreamUrls {
  streamName: string;
  webrtc: string;
  hls: string;
  mse: string;
  rtsp?: string;
}

export interface PlaybackStreamUrls extends StreamUrls {
  date: string;
  time: string;
  duration: number;
}

// One enabled camera's stream, returned in bulk by GET /api/nvr/:id/streams
export interface NvrStream {
  channel: number;
  name: string;
  streamName: string;
  webrtc: string;
  hls: string;
  mse: string;
}

// ── Auth ────────────────────────────────────────────────

export interface LoginResponse {
  token: string;
  user: {
    id: number;
    username: string;
    role: 'admin' | 'viewer';
    created_at: string;
  };
}

// ── Floor-plan Layout ───────────────────────────────────

export interface Layout {
  id: number;
  name: string;
  image_mime: string | null;
  has_image: boolean;
  created_at: string;
  updated_at: string;
}

export interface Placement {
  id: number;
  layout_id: number;
  nvr_id: number;
  channel: number;
  label: string | null;
  x: number;
  y: number;
  created_at: string;
}

export interface LayoutDetail extends Layout {
  placements: Placement[];
}

// ── Grid Layout ─────────────────────────────────────────

export type GridLayout = '1x1' | '2x2' | '3x3' | '4x4';

export interface GridCell {
  index: number;
  nvrId: number | null;
  channel: number | null;
  cameraName?: string;
}
