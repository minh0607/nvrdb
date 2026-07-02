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
  /** Area (building zone) this NVR belongs to. null = ungrouped. */
  area_id: number | null;
  status: 'online' | 'offline' | 'error';
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Public (no-auth) NVR + Camera ───────────────────────

export interface PublicNvr {
  id: number;
  name: string;
  max_channels: number;
  /** Area (building zone) this NVR belongs to. null = ungrouped. */
  area_id: number | null;
}

export interface PublicCamera {
  channel: number;
  name: string;
  enabled: boolean;
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
  /** Area (building zone) to assign this NVR to. null/omitted = ungrouped. */
  area_id?: number | null;
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

// ── Area (building zone grouping layouts) ───────────────

export interface Area {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
}

// ── Floor-plan Layout ───────────────────────────────────

export interface Layout {
  id: number;
  name: string;
  image_mime: string | null;
  has_image: boolean;
  /** Optional frame aspect (pixels). null = derive from image / default 16:9. */
  width: number | null;
  height: number | null;
  /** Area this layout belongs to. null = ungrouped ("General"). */
  area_id: number | null;
  created_at: string;
  updated_at: string;
}

// How a placement's live video is opened: browser go2rtc player or external VLC.
export type ViewMode = 'go2rtc' | 'vlc';

export interface Placement {
  id: number;
  layout_id: number;
  nvr_id: number;
  channel: number;
  label: string | null;
  x: number;
  y: number;
  /** Per-placement view-mode override. null = fall back to the global default. */
  view_mode: ViewMode | null;
  created_at: string;
  /** Current camera name (JOIN result); used as a fallback marker label. */
  camera_name?: string | null;
}

// ── App Settings ────────────────────────────────────────

export interface AppSettings {
  default_view_mode: ViewMode;
  /**
   * URL to the VLC installer .exe used by the downloadable setup script.
   * Admin-only: present only for authenticated admins; undefined for viewers.
   */
  vlc_download_url?: string;
}

// ── Access Control (IP allowlist) ───────────────────────

export interface AllowedIp {
  id: number;
  ip: string;
  label: string | null;
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
