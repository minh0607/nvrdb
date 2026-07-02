import { Router, type Request, type Response, type NextFunction } from 'express';
import { NvrService } from '../services/nvr.service.js';
import { Go2rtcService } from '../services/go2rtc.service.js';
import { SettingsService } from '../services/settings.service.js';
import { successResponse, errorResponse } from '../models/schemas.js';
import { env } from '../config/env.js';

const router = Router();

/**
 * Strip characters that could break out of a PowerShell double-quoted string
 * (quotes, backticks, `;`, `$`, `()`, backslash, CR/LF). Applied as
 * defense-in-depth to every value interpolated into the generated script.
 */
function sanitizePsString(s: string): string {
  return s.replace(/["`;$()\\\r\n]/g, '');
}

/**
 * Parse a route param as a positive integer. Returns null on NaN / non-integer,
 * so an unparsed param can't slip past range checks (mirrors stream.routes.ts).
 */
function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * GET /api/public/streams/:nvrId/:channel
 * Public LIVE stream URLs for a camera (no auth, no playback).
 *
 * SECURITY: returns only go2rtc stream URLs — never the rtsp:// source, which
 * embeds NVR credentials. No outbound NVR HTTP calls are made here.
 */
router.get('/streams/:nvrId/:channel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const nvrId = parsePositiveInt(req.params.nvrId);
    const channel = parsePositiveInt(req.params.channel);
    if (nvrId === null || channel === null) {
      res.status(400).json(errorResponse('Invalid nvrId or channel'));
      return;
    }

    const nvr = NvrService.findById(nvrId);
    if (!nvr) {
      res.status(404).json(errorResponse('NVR device not found'));
      return;
    }

    if (channel > nvr.max_channels) {
      res.status(400).json(errorResponse(`Channel must be between 1 and ${nvr.max_channels}`));
      return;
    }

    const camera = NvrService.getCamera(nvrId, channel);
    if (!camera || !camera.enabled) {
      res.status(404).json(errorResponse('Camera not found or not available'));
      return;
    }

    const streamName = Go2rtcService.streamName(nvrId, channel);
    const rtspUrl = NvrService.resolveRtspUrl(nvr, channel);
    await Go2rtcService.addStream(streamName, rtspUrl);

    res.json(
      successResponse({
        streamName,
        webrtc: Go2rtcService.getWebRtcUrl(streamName),
        hls: Go2rtcService.getHlsUrl(streamName),
        mse: Go2rtcService.getMseUrl(streamName),
      }),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/public/vlc/:nvrId/:channel
 * Public (no auth). Returns the raw rtsp:// URL for opening the camera in an
 * external VLC player ("VLC mode").
 *
 * SECURITY: This response INTENTIONALLY carries NVR credentials in the rtsp URL
 * — that is the whole point of VLC mode (VLC needs the full URL to connect).
 * This is a deliberate product decision: the endpoint is public, NOT gated on
 * any admin assumption. The deployment is expected to use a dedicated view-only
 * NVR account so the exposed credentials grant nothing beyond live viewing.
 */
router.get('/vlc/:nvrId/:channel', (req: Request, res: Response, next: NextFunction) => {
  try {
    const nvrId = parsePositiveInt(req.params.nvrId);
    const channel = parsePositiveInt(req.params.channel);
    if (nvrId === null || channel === null) {
      res.status(400).json(errorResponse('Invalid nvrId or channel'));
      return;
    }

    const nvr = NvrService.findById(nvrId);
    if (!nvr) {
      res.status(404).json(errorResponse('NVR device not found'));
      return;
    }

    if (channel > nvr.max_channels) {
      res.status(400).json(errorResponse(`Channel must be between 1 and ${nvr.max_channels}`));
      return;
    }

    const camera = NvrService.getCamera(nvrId, channel);
    if (!camera || !camera.enabled) {
      res.status(404).json(errorResponse('Camera not found or not available'));
      return;
    }

    res.json(successResponse({ rtsp: NvrService.resolveRtspUrl(nvr, channel) }));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/public/vlc-setup.ps1
 * Public (no auth). Returns a downloadable PowerShell script that installs VLC,
 * registers the rtsp:// protocol handler, and configures the browser to auto-open
 * rtsp links without a prompt for this dashboard's origin.
 *
 * The script text is emitted verbatim; only ${vlcUrl} and ${origin} are
 * interpolated by the server. All PowerShell backticks and backslashes below are
 * escaped for the TS template literal so the runtime output is valid PowerShell.
 *
 * SECURITY: the origin comes from the SERVER-side CORS_ORIGIN env var, never from
 * the client-controlled Host header, so a crafted request can't inject PowerShell.
 * Both interpolated values are additionally run through sanitizePsString().
 */
router.get('/vlc-setup.ps1', (_req: Request, res: Response) => {
  const origin = env.CORS_ORIGIN;

  const configured = SettingsService.getVlcDownloadUrl();
  const vlcUrl = configured || 'http://REPLACE-WITH-VLC-INSTALLER-URL/vlc.exe';

  const script = `# setup-vlc-rtsp.ps1  (auto-generated by NVR Dashboard) - RUN AS ADMINISTRATOR
# 1) download+install VLC  2) register rtsp:// -> VLC  3) auto-open rtsp (no prompt)
$VLC_URL = "${sanitizePsString(vlcUrl)}"
$ORIGINS = @("${sanitizePsString(origin)}")

$adm = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $adm) { Write-Host "Run as Administrator (right-click -> Run as administrator)." -ForegroundColor Red; exit 1 }

$installer = Join-Path $env:TEMP "vlc-setup.exe"
Write-Host "Downloading VLC from $VLC_URL ..."
try { $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri $VLC_URL -OutFile $installer -UseBasicParsing } catch { Write-Host "Download failed: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
Write-Host "Installing VLC (silent)..."
Start-Process -FilePath $installer -ArgumentList "/S" -Wait

$vlc = "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe"
if (-not (Test-Path $vlc)) { $vlc = "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe" }
if (-not (Test-Path $vlc)) { Write-Host "vlc.exe not found after install." -ForegroundColor Red; exit 1 }

# register rtsp:// -> VLC (machine-wide)
$base="HKLM:\\SOFTWARE\\Classes\\rtsp"; $cmd="$base\\shell\\open\\command"
New-Item -Path $base -Force | Out-Null
Set-ItemProperty -Path $base -Name "(default)" -Value "URL:RTSP Protocol"
Set-ItemProperty -Path $base -Name "URL Protocol" -Value ""
New-Item -Path $cmd -Force | Out-Null
Set-ItemProperty -Path $cmd -Name "(default)" -Value ("\`"{0}\`" \`"%1\`"" -f $vlc)

# browser auto-open policy (no prompt) for this dashboard origin
$json = '[{"protocol":"rtsp","allowed_origins":["' + ($ORIGINS -join '","') + '"]}]'
foreach ($p in @("HKLM:\\SOFTWARE\\Policies\\Google\\Chrome","HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge")) {
  New-Item -Path $p -Force | Out-Null
  Set-ItemProperty -Path $p -Name "AutoLaunchProtocolsFromOrigins" -Value $json -Type String
}
Write-Host "DONE. Close and reopen the browser. rtsp links now open VLC without a prompt." -ForegroundColor Green
`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="setup-vlc-rtsp.ps1"');
  res.send(script);
});

/**
 * GET /api/public/nvrs
 * Public (no auth). List NVRs for the public live-grid picker.
 *
 * SECURITY: projects each device to ONLY non-sensitive fields
 * ({ id, name, max_channels, area_id }). Never exposes ip/username/password/ports
 * /model/status. Reads the DB only — no outbound NVR HTTP.
 */
router.get('/nvrs', (_req: Request, res: Response) => {
  const nvrs = NvrService.findAll();
  const safe = nvrs.map(({ id, name, max_channels, area_id }) => ({
    id,
    name,
    max_channels,
    area_id,
  }));
  res.json(successResponse(safe));
});

/**
 * GET /api/public/nvrs/:id/cameras
 * Public (no auth). List an NVR's cameras for the public live-grid.
 *
 * SECURITY: projects each camera to ONLY { channel, name, enabled }. Never
 * exposes rtsp_override (which can embed NVR credentials) or any other field.
 * Reads cached DB rows only — never triggers syncCameras (SSRF-safe posture).
 */
router.get('/nvrs/:id/cameras', (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json(errorResponse('Invalid id'));
    return;
  }

  const nvr = NvrService.findById(id);
  if (!nvr) {
    res.status(404).json(errorResponse('NVR device not found'));
    return;
  }

  // getCameras() already orders by channel ascending.
  const cameras = NvrService.getCameras(id);
  const safe = cameras.map((cam) => ({
    channel: cam.channel,
    name: cam.name,
    enabled: !!cam.enabled,
  }));
  res.json(successResponse(safe));
});

export default router;
