import { Router, type Request, type Response, type NextFunction } from 'express';
import { NvrService } from '../services/nvr.service.js';
import { Go2rtcService } from '../services/go2rtc.service.js';
import { successResponse, errorResponse } from '../models/schemas.js';

const router = Router();

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

export default router;
