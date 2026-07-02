import { Router, type Request, type Response, type NextFunction } from 'express';
import { SettingsService } from '../services/settings.service.js';
import { updateSettingsSchema, successResponse } from '../models/schemas.js';
import { authRequired, adminOnly } from '../middleware/auth.middleware.js';
import { AuthService } from '../services/auth.service.js';

const router = Router();

/**
 * GET /api/settings
 * Semi-public. The global default view mode is always returned so any viewer can
 * decide how to render cameras without a per-camera override. The vlc_download_url
 * is ADMIN-ONLY (it's an operator config value), so it is included only when the
 * request carries a valid admin bearer token; anonymous/viewer callers omit it.
 */
router.get('/', (req: Request, res: Response) => {
  const body: { default_view_mode: 'go2rtc' | 'vlc'; vlc_download_url?: string } = {
    default_view_mode: SettingsService.getDefaultViewMode(),
  };

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const payload = AuthService.verifyToken(authHeader.slice('Bearer '.length));
    if (payload && payload.role === 'admin') {
      body.vlc_download_url = SettingsService.getVlcDownloadUrl();
    }
  }

  res.json(successResponse(body));
});

/**
 * PUT /api/settings
 * Update the global default view mode and/or the VLC installer URL. Admin only.
 * Applies whichever of the two fields are present in the request.
 */
router.put('/', authRequired, adminOnly, (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = updateSettingsSchema.parse(req.body);
    if (input.default_view_mode !== undefined) {
      SettingsService.set('default_view_mode', input.default_view_mode);
    }
    if (input.vlc_download_url !== undefined) {
      SettingsService.setVlcDownloadUrl(input.vlc_download_url);
    }
    res.json(
      successResponse({
        default_view_mode: SettingsService.getDefaultViewMode(),
        vlc_download_url: SettingsService.getVlcDownloadUrl(),
      }),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
