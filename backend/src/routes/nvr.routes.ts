import { Router, type Request, type Response, type NextFunction } from 'express';
import { NvrService } from '../services/nvr.service.js';
import { HanwhaService } from '../services/hanwha.service.js';
import { Go2rtcService } from '../services/go2rtc.service.js';
import {
  createNvrSchema,
  updateNvrSchema,
  updateCameraSchema,
  successResponse,
  errorResponse,
} from '../models/schemas.js';
import { authRequired, adminOnly } from '../middleware/auth.middleware.js';
import { logger } from '../config/logger.js';

const router = Router();

// All NVR routes require authentication
router.use(authRequired);

/**
 * GET /api/nvr
 * List all registered NVR devices.
 */
router.get('/', (_req: Request, res: Response) => {
  const nvrs = NvrService.findAll();

  // Strip passwords from the response
  const safe = nvrs.map(({ password, ...rest }) => rest);
  res.json(successResponse(safe));
});

/**
 * GET /api/nvr/:id
 * Get a single NVR device by ID.
 */
router.get('/:id', (req: Request, res: Response) => {
  const nvr = NvrService.findById(Number(req.params.id));
  if (!nvr) {
    res.status(404).json(errorResponse('NVR device not found'));
    return;
  }

  const { password, ...safe } = nvr;
  res.json(successResponse(safe));
});

/**
 * POST /api/nvr
 * Register a new NVR device. Admin only.
 */
router.post('/', adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createNvrSchema.parse(req.body);
    const nvr = NvrService.create(input);

    // Sync cameras from the NVR (non-fatal: can be synced later)
    await NvrService.syncCameras(nvr.id).catch((err) => {
      logger.warn({ nvrId: nvr.id, err }, 'Non-fatal: camera sync failed on create');
    });

    // Register streams with go2rtc (non-fatal: can be registered later)
    await NvrService.registerStreams(nvr.id).catch((err) => {
      logger.warn({ nvrId: nvr.id, err }, 'Non-fatal: stream registration failed on create');
    });

    const { password, ...safe } = nvr;
    res.status(201).json(successResponse(safe));
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/nvr/:id
 * Update an NVR device. Admin only.
 */
router.put('/:id', adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = updateNvrSchema.parse(req.body);
    const nvr = NvrService.update(Number(req.params.id), input);

    if (!nvr) {
      res.status(404).json(errorResponse('NVR device not found'));
      return;
    }

    // Re-register streams if connection details changed
    if (input.ip || input.rtsp_port || input.username || input.password) {
      await NvrService.registerStreams(nvr.id).catch((err) => {
        logger.warn({ nvrId: nvr.id, err }, 'Non-fatal: stream re-registration failed on update');
      });
    }

    const { password, ...safe } = nvr;
    res.json(successResponse(safe));
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/nvr/:id
 * Remove an NVR device. Admin only.
 */
router.delete('/:id', adminOnly, (req: Request, res: Response) => {
  const deleted = NvrService.delete(Number(req.params.id));
  if (!deleted) {
    res.status(404).json(errorResponse('NVR device not found'));
    return;
  }
  res.json(successResponse({ deleted: true }));
});

/**
 * GET /api/nvr/:id/cameras
 * Get cameras for an NVR. Triggers sync if none exist.
 */
router.get('/:id/cameras', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const nvrId = Number(req.params.id);
    const nvr = NvrService.findById(nvrId);
    if (!nvr) {
      res.status(404).json(errorResponse('NVR device not found'));
      return;
    }

    let cameras = NvrService.getCameras(nvrId);

    // Auto-sync on first access — but only for admins. syncCameras makes an
    // outbound HTTP request to the NVR IP (an SSRF-capable side effect), so it
    // must not be triggerable by non-admin viewers. Viewers get whatever is
    // already cached; an admin can populate it via the explicit sync endpoint.
    if (cameras.length === 0 && req.user?.role === 'admin') {
      cameras = await NvrService.syncCameras(nvrId);
    }

    // rtsp_override can embed NVR credentials, so it must not leak to non-admins.
    // Admins keep it (the editor displays the current override).
    const isAdmin = req.user?.role === 'admin';
    const out = cameras.map((c) => (isAdmin ? c : (({ rtsp_override, ...rest }) => rest)(c)));
    res.json(successResponse(out));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/nvr/:id/streams
 * Bulk: register ALL enabled cameras of an NVR with go2rtc (in parallel) and
 * return their stream URLs in one response. Powers the Live View "select an NVR
 * to load all its cameras" flow with a single round-trip instead of N.
 */
router.get('/:id/streams', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const nvrId = Number(req.params.id);
    const nvr = NvrService.findById(nvrId);
    if (!nvr) {
      res.status(404).json(errorResponse('NVR device not found'));
      return;
    }

    let cameras = NvrService.getCameras(nvrId);
    if (cameras.length === 0 && req.user?.role === 'admin') {
      cameras = await NvrService.syncCameras(nvrId);
    }
    const enabled = cameras.filter((c) => c.enabled);

    const streams = await Promise.all(
      enabled.map(async (cam) => {
        const streamName = Go2rtcService.streamName(nvrId, cam.channel);
        const rtspUrl = HanwhaService.buildRtspUrl(nvr, cam.channel);
        await Go2rtcService.addStream(streamName, rtspUrl);
        return {
          channel: cam.channel,
          name: cam.name,
          streamName,
          webrtc: Go2rtcService.getWebRtcUrl(streamName),
          hls: Go2rtcService.getHlsUrl(streamName),
          mse: Go2rtcService.getMseUrl(streamName),
        };
      }),
    );

    res.json(successResponse(streams));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/nvr/:id/cameras/sync
 * Force re-sync cameras from the NVR. Admin only.
 */
router.post(
  '/:id/cameras/sync',
  adminOnly,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const nvrId = Number(req.params.id);
      const cameras = await NvrService.syncCameras(nvrId);
      res.json(successResponse(cameras));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PUT /api/nvr/:nvrId/cameras/:channel
 * Update a camera's editable fields (name/enabled/rtsp_override). Admin only.
 */
router.put(
  '/:nvrId/cameras/:channel',
  adminOnly,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const nvrId = Number(req.params.nvrId);
      const channel = Number(req.params.channel);
      const input = updateCameraSchema.parse(req.body);
      const camera = NvrService.updateCamera(nvrId, channel, input);

      if (!camera) {
        res.status(404).json(errorResponse('Camera not found'));
        return;
      }

      res.json(successResponse(camera));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/nvr/:id/status
 * Check NVR connectivity status. Admin only.
 */
router.post('/:id/status', adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const nvrId = Number(req.params.id);
    const status = await NvrService.checkAndUpdateStatus(nvrId);
    res.json(successResponse({ id: nvrId, status }));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/nvr/:id/streams/register
 * Register all streams for an NVR with go2rtc. Admin only.
 */
router.post(
  '/:id/streams/register',
  adminOnly,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const nvrId = Number(req.params.id);
      const count = await NvrService.registerStreams(nvrId);
      res.json(successResponse({ registered: count }));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
