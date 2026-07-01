import { z } from 'zod';
import { env } from '../config/env.js';

// ── NVR Device ──────────────────────────────────────────────

/**
 * SSRF guard for the NVR IP field. `z.string().ip()` only checks syntax, so the
 * server would otherwise fetch any address it's given (cloud metadata, link-local,
 * broadcast). NVRs legitimately live on private LANs, so private ranges stay
 * allowed; we block only addresses that are never a real NVR and are SSRF-prone.
 * Loopback is allowed in non-production for local/synthetic testing.
 */
function isBlockedNvrIp(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 169 && b === 254) return true; // link-local / cloud metadata (169.254.169.254)
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255
  if (a === 127 && env.NODE_ENV === 'production') return true; // loopback (allowed in dev)
  return false;
}

const nvrIpSchema = z
  .string()
  .ip({ version: 'v4' })
  .refine((ip) => !isBlockedNvrIp(ip), {
    message: 'IP address is not permitted (loopback/link-local/reserved range)',
  });

export const createNvrSchema = z.object({
  name: z.string().min(1).max(100),
  ip: nvrIpSchema,
  http_port: z.number().int().min(1).max(65535).default(80),
  rtsp_port: z.number().int().min(1).max(65535).default(554),
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(255),
  model: z.string().default('XRN-1620SB1'),
  max_channels: z.number().int().min(1).max(128).default(16),
  // Optional Hanwha RTSP profile for the grid (sub-stream). Leave unset to use the
  // channel's default (main) profile. Set to the H.264 sub-stream profile number
  // (often 2 or 3 — varies by camera config) when the main stream is H.265, which
  // browsers can't play over WebRTC/HLS. URL becomes …/media.smp/profile=<n>.
  stream_profile: z.number().int().min(1).max(20).nullable().optional(),
});

export const updateNvrSchema = createNvrSchema.partial();

export type CreateNvrInput = z.infer<typeof createNvrSchema>;
export type UpdateNvrInput = z.infer<typeof updateNvrSchema>;

// ── Camera ──────────────────────────────────────────────────

export const cameraSchema = z.object({
  channel: z.number().int().min(1),
  name: z.string().min(1).max(100),
  resolution: z.string().default('1920x1080'),
  codec: z.string().default('H.264'),
  fps: z.number().int().min(1).max(60).default(30),
  enabled: z.boolean().default(true),
  ptz_supported: z.boolean().default(false),
});

export type CameraInput = z.infer<typeof cameraSchema>;

/**
 * Admin-editable camera fields: display name, enabled flag, and an optional
 * per-camera RTSP override that supersedes the derived Hanwha URL when set.
 */
export const updateCameraSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  rtsp_override: z
    .string()
    .max(500)
    .regex(/^rtsps?:\/\//i, 'rtsp_override must start with rtsp:// or rtsps://')
    .nullable()
    .optional(),
});

export type UpdateCameraInput = z.infer<typeof updateCameraSchema>;

// ── Layout ──────────────────────────────────────────────────

export const createLayoutSchema = z.object({
  name: z.string().min(1).max(100),
});

export const updateLayoutSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

export type CreateLayoutInput = z.infer<typeof createLayoutSchema>;
export type UpdateLayoutInput = z.infer<typeof updateLayoutSchema>;

// ── Layout Placement ────────────────────────────────────────
// x and y are percentages (0..100) of the floor-plan image dimensions.

export const createPlacementSchema = z.object({
  nvr_id: z.number().int().positive(),
  channel: z.number().int().positive(),
  label: z.string().max(100).nullable().optional(),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
});

export const updatePlacementSchema = z.object({
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
  label: z.string().max(100).nullable().optional(),
});

export type CreatePlacementInput = z.infer<typeof createPlacementSchema>;
export type UpdatePlacementInput = z.infer<typeof updatePlacementSchema>;

// ── Auth ────────────────────────────────────────────────────

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;

// ── Playback ────────────────────────────────────────────────

export const playbackQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM').optional(),
  duration: z.coerce.number().int().min(1).max(3600).default(300),
});

export type PlaybackQuery = z.infer<typeof playbackQuerySchema>;

// ── API Response Envelope ───────────────────────────────────

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

export function successResponse<T>(data: T, meta?: ApiResponse['meta']): ApiResponse<T> {
  return { success: true, data, error: null, meta };
}

export function errorResponse(message: string): ApiResponse<null> {
  return { success: false, data: null, error: message };
}

// ── Database Row Types ──────────────────────────────────────

export interface NvrDeviceRow {
  id: number;
  name: string;
  ip: string;
  http_port: number;
  rtsp_port: number;
  username: string;
  password: string;
  model: string;
  max_channels: number;
  stream_profile: number | null;
  status: 'online' | 'offline' | 'error';
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CameraRow {
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

export interface LayoutRow {
  id: number;
  name: string;
  image_path: string | null;
  image_mime: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlacementRow {
  id: number;
  layout_id: number;
  nvr_id: number;
  channel: number;
  label: string | null;
  x: number;
  y: number;
  created_at: string;
}

export interface StreamSessionRow {
  id: number;
  nvr_id: number;
  camera_id: number;
  stream_name: string;
  protocol: 'webrtc' | 'hls' | 'mse';
  started_at: string;
  last_active_at: string;
}

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'viewer';
  created_at: string;
}
