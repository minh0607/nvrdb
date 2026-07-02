import { Router, type Request, type Response, type NextFunction } from 'express';
import { AreaService } from '../services/area.service.js';
import {
  createAreaSchema,
  updateAreaSchema,
  successResponse,
  errorResponse,
} from '../models/schemas.js';
import { authRequired, adminOnly } from '../middleware/auth.middleware.js';

const router = Router();

/**
 * Parse a route param as a positive integer. Returns null on NaN / non-integer,
 * so an unparsed param can't slip past range checks (mirrors layout.routes.ts).
 */
function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── Public routes (no auth) ─────────────────────────────────

/**
 * GET /api/areas
 * List all grouping areas (public).
 */
router.get('/', (_req: Request, res: Response) => {
  res.json(successResponse(AreaService.list()));
});

// ── Admin routes ────────────────────────────────────────────

/**
 * POST /api/areas
 * Create a new area. Admin only.
 */
router.post('/', authRequired, adminOnly, (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createAreaSchema.parse(req.body);
    const area = AreaService.create(input);
    res.status(201).json(successResponse(area));
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/areas/:id
 * Update an area's name/sort order. Admin only.
 */
router.put('/:id', authRequired, adminOnly, (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json(errorResponse('Invalid area id'));
      return;
    }

    const input = updateAreaSchema.parse(req.body);
    const area = AreaService.update(id, input);
    if (!area) {
      res.status(404).json(errorResponse('Area not found'));
      return;
    }

    res.json(successResponse(area));
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/areas/:id
 * Delete an area (ungroups its layouts, never deletes them). Admin only.
 */
router.delete('/:id', authRequired, adminOnly, (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json(errorResponse('Invalid area id'));
    return;
  }

  const deleted = AreaService.delete(id);
  if (!deleted) {
    res.status(404).json(errorResponse('Area not found'));
    return;
  }

  res.json(successResponse({ deleted: true }));
});

export default router;
