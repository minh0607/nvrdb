import type { Request, Response, NextFunction } from 'express';
import { AllowedIpService } from '../services/allowed-ip.service.js';
import { errorResponse } from '../models/schemas.js';

/**
 * Global IP allowlist gate.
 *
 * The client IP is taken from the raw socket (`req.socket.remoteAddress`) and
 * NOT from a proxy header (X-Forwarded-For), because the deployment bundle has
 * no reverse proxy — trusting a client-supplied header would let anyone spoof an
 * allowed address. Loopback is always allowed by AllowedIpService, and an empty
 * allowlist is open by default.
 */
export function ipAllowlist(req: Request, res: Response, next: NextFunction): void {
  const clientIp = req.socket.remoteAddress ?? '';

  if (AllowedIpService.isAllowed(clientIp)) {
    next();
    return;
  }

  res.status(403).json(errorResponse('Access denied for your IP address'));
}
