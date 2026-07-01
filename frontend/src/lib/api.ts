import type {
  ApiResponse,
  Camera,
  CreateNvrInput,
  Layout,
  LayoutDetail,
  LoginResponse,
  NvrDevice,
  NvrStream,
  Placement,
  PlaybackStreamUrls,
  StreamUrls,
} from '../types/api';

/**
 * Thin typed client for the NVR Dashboard backend.
 *
 * All backend responses use the envelope { success, data, error }. Each method
 * unwraps `data` and throws an Error(message) on failure so callers can use
 * plain try/catch. Requests are same-origin: the Vite dev server proxies `/api`
 * to :3001, and in production the backend serves the SPA from the same origin.
 */

const TOKEN_KEY = 'nvr_dashboard_token';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Send the Authorization header (default true). Public endpoints pass false. */
  auth?: boolean;
}

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let payload: ApiResponse<T> | null = null;
  try {
    payload = (await res.json()) as ApiResponse<T>;
  } catch {
    // Non-JSON response (e.g. a proxy/network error page).
  }

  if (!res.ok || !payload || !payload.success) {
    const message = payload?.error ?? `Request failed (${res.status})`;
    throw new Error(message);
  }

  return payload.data as T;
}

export const api = {
  // ── token helpers ─────────────────────────────────────────
  getToken,

  // ── auth ──────────────────────────────────────────────────
  async login(username: string, password: string): Promise<LoginResponse> {
    const result = await request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { username, password },
      auth: false,
    });
    setToken(result.token);
    return result;
  },

  logout(): void {
    clearToken();
  },

  // ── NVR devices ───────────────────────────────────────────
  listNvrs(): Promise<NvrDevice[]> {
    return request<NvrDevice[]>('/nvr');
  },

  createNvr(input: CreateNvrInput): Promise<NvrDevice> {
    return request<NvrDevice>('/nvr', { method: 'POST', body: input });
  },

  updateNvr(id: number, input: Partial<CreateNvrInput>): Promise<NvrDevice> {
    return request<NvrDevice>(`/nvr/${id}`, { method: 'PUT', body: input });
  },

  deleteNvr(id: number): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>(`/nvr/${id}`, { method: 'DELETE' });
  },

  // ── cameras ───────────────────────────────────────────────
  getCameras(nvrId: number): Promise<Camera[]> {
    return request<Camera[]>(`/nvr/${nvrId}/cameras`);
  },

  syncCameras(nvrId: number): Promise<Camera[]> {
    return request<Camera[]>(`/nvr/${nvrId}/cameras/sync`, { method: 'POST' });
  },

  checkNvrStatus(nvrId: number): Promise<{ id: number; status: string }> {
    return request<{ id: number; status: string }>(`/nvr/${nvrId}/status`, {
      method: 'POST',
    });
  },

  // ── streams ───────────────────────────────────────────────
  getNvrStreams(nvrId: number): Promise<NvrStream[]> {
    return request<NvrStream[]>(`/nvr/${nvrId}/streams`);
  },

  getStreamUrls(nvrId: number, channel: number): Promise<StreamUrls> {
    return request<StreamUrls>(`/streams/${nvrId}/${channel}`);
  },

  getPlaybackUrls(
    nvrId: number,
    channel: number,
    params: { date: string; time?: string; duration?: number },
  ): Promise<PlaybackStreamUrls> {
    const q = new URLSearchParams();
    q.set('date', params.date);
    if (params.time) q.set('time', params.time);
    if (params.duration) q.set('duration', String(params.duration));
    return request<PlaybackStreamUrls>(`/streams/playback/${nvrId}/${channel}?${q.toString()}`);
  },

  // ── public streams (no auth) ──────────────────────────────
  getPublicStreamUrls(nvrId: number, channel: number): Promise<StreamUrls> {
    return request<StreamUrls>(`/public/streams/${nvrId}/${channel}`, { auth: false });
  },

  // ── floor-plan layouts ────────────────────────────────────
  listLayouts(): Promise<Layout[]> {
    return request<Layout[]>('/layouts', { auth: false });
  },

  getLayout(id: number): Promise<LayoutDetail> {
    return request<LayoutDetail>(`/layouts/${id}`, { auth: false });
  },

  createLayout(name: string): Promise<Layout> {
    return request<Layout>('/layouts', { method: 'POST', body: { name } });
  },

  updateLayout(id: number, name: string): Promise<Layout> {
    return request<Layout>(`/layouts/${id}`, { method: 'PUT', body: { name } });
  },

  deleteLayout(id: number): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>(`/layouts/${id}`, { method: 'DELETE' });
  },

  /**
   * Upload a floor-plan image as the raw request body. The shared `request`
   * helper JSON-stringifies bodies, so this call is done directly and unwraps
   * the { success, data, error } envelope itself.
   */
  async uploadLayoutImage(id: number, file: Blob): Promise<Layout> {
    const token = getToken();
    const headers: Record<string, string> = { 'Content-Type': file.type };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/layouts/${id}/image`, {
      method: 'POST',
      headers,
      body: file,
    });

    let payload: ApiResponse<Layout> | null = null;
    try {
      payload = (await res.json()) as ApiResponse<Layout>;
    } catch {
      // Non-JSON response.
    }

    if (!res.ok || !payload || !payload.success) {
      const message = payload?.error ?? `Upload failed (${res.status})`;
      throw new Error(message);
    }

    return payload.data as Layout;
  },

  /**
   * Same-origin URL for a layout's floor-plan image (used directly in <img src>).
   * Pass the layout's `updated_at` as `updatedAt` to cache-bust after a replace,
   * so a new image is fetched instead of a stale cached copy.
   */
  layoutImageUrl(id: number, updatedAt?: string): string {
    const base = `/api/layouts/${id}/image`;
    return updatedAt ? `${base}?v=${encodeURIComponent(updatedAt)}` : base;
  },

  // ── placements ────────────────────────────────────────────
  addPlacement(
    layoutId: number,
    body: { nvr_id: number; channel: number; label?: string; x: number; y: number },
  ): Promise<Placement> {
    return request<Placement>(`/layouts/${layoutId}/placements`, {
      method: 'POST',
      body,
    });
  },

  updatePlacement(
    layoutId: number,
    pid: number,
    body: { x?: number; y?: number; label?: string },
  ): Promise<Placement> {
    return request<Placement>(`/layouts/${layoutId}/placements/${pid}`, {
      method: 'PUT',
      body,
    });
  },

  deletePlacement(layoutId: number, pid: number): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>(`/layouts/${layoutId}/placements/${pid}`, {
      method: 'DELETE',
    });
  },

  // ── camera edit (incl. rtsp override) ─────────────────────
  updateCamera(
    nvrId: number,
    channel: number,
    body: { name?: string; enabled?: boolean; rtsp_override?: string | null },
  ): Promise<Camera> {
    return request<Camera>(`/nvr/${nvrId}/cameras/${channel}`, {
      method: 'PUT',
      body,
    });
  },
};
