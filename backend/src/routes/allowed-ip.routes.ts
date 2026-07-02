import { Router, type Request, type Response, type NextFunction } from 'express';
import { AllowedIpService } from '../services/allowed-ip.service.js';
import { createAllowedIpSchema, successResponse, errorResponse } from '../models/schemas.js';
import { authRequired, adminOnly } from '../middleware/auth.middleware.js';

const router = Router();

// The entire allowlist admin surface requires an authenticated admin.
router.use(authRequired, adminOnly);

/**
 * Parse a route param as a positive integer. Returns null on NaN / non-integer.
 */
function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * GET /api/allowed-ips
 * List all allowlist entries.
 */
router.get('/', (_req: Request, res: Response) => {
  res.json(successResponse(AllowedIpService.list()));
});

/**
 * POST /api/allowed-ips
 * Add an IPv4 address or CIDR to the allowlist.
 */
router.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createAllowedIpSchema.parse(req.body);
    const row = AllowedIpService.add(input);
    res.status(201).json(successResponse(row));
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/allowed-ips/:id
 * Remove an allowlist entry.
 */
router.delete('/:id', (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json(errorResponse('Invalid allowed IP id'));
    return;
  }

  const deleted = AllowedIpService.delete(id);
  if (!deleted) {
    res.status(404).json(errorResponse('Allowed IP not found'));
    return;
  }

  res.json(successResponse({ deleted: true }));
});

export default router;
