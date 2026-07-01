import { Router, type Request, type Response, type NextFunction } from 'express';
import express from 'express';
import fs from 'fs';
import {
  LayoutService,
  ensureLayoutsDir,
  layoutImagePath,
} from '../services/layout.service.js';
import {
  createLayoutSchema,
  updateLayoutSchema,
  createPlacementSchema,
  updatePlacementSchema,
  successResponse,
  errorResponse,
  type LayoutRow,
} from '../models/schemas.js';
import { authRequired, adminOnly } from '../middleware/auth.middleware.js';

const router = Router();

// Supported image MIME types and their file extensions for stored floor plans.
// SVG intentionally excluded — can embed <script> → stored XSS. Do not add image/svg+xml.
const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const RAW_IMAGE_LIMIT = '15mb';

/**
 * Public shape of a layout: adds `has_image` and never leaks the on-disk path.
 */
function toPublicLayout(layout: LayoutRow): {
  id: number;
  name: string;
  has_image: boolean;
  image_mime: string | null;
  created_at: string;
  updated_at: string;
} {
  return {
    id: layout.id,
    name: layout.name,
    has_image: !!layout.image_path,
    image_mime: layout.image_mime,
    created_at: layout.created_at,
    updated_at: layout.updated_at,
  };
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

// ── Public routes (no auth) ─────────────────────────────────

/**
 * GET /api/layouts
 * List all layouts (public). Never exposes the image file path.
 */
router.get('/', (_req: Request, res: Response) => {
  const layouts = LayoutService.findAll();
  res.json(successResponse(layouts.map(toPublicLayout)));
});

/**
 * GET /api/layouts/:id
 * Get a single layout with its placements (public).
 */
router.get('/:id', (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json(errorResponse('Invalid layout id'));
    return;
  }

  const layout = LayoutService.findById(id);
  if (!layout) {
    res.status(404).json(errorResponse('Layout not found'));
    return;
  }

  const placements = LayoutService.getPlacements(id);
  res.json(successResponse({ ...toPublicLayout(layout), placements }));
});

/**
 * GET /api/layouts/:id/image
 * Stream the floor-plan image file (public).
 */
router.get('/:id/image', (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json(errorResponse('Invalid layout id'));
    return;
  }

  const layout = LayoutService.findById(id);
  if (!layout || !layout.image_path) {
    res.status(404).json(errorResponse('Layout image not found'));
    return;
  }

  const filePath = layoutImagePath(layout.image_path);
  if (!fs.existsSync(filePath)) {
    res.status(404).json(errorResponse('Layout image not found'));
    return;
  }

  res.setHeader('Content-Type', layout.image_mime ?? 'application/octet-stream');
  // A layout image can be replaced in place (same URL), so don't let clients or
  // proxies serve a stale copy.
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(filePath).pipe(res);
});

// ── Admin routes ────────────────────────────────────────────

/**
 * POST /api/layouts
 * Create a new layout. Admin only.
 */
router.post('/', authRequired, adminOnly, (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createLayoutSchema.parse(req.body);
    const layout = LayoutService.create(input.name);
    res.status(201).json(successResponse(toPublicLayout(layout)));
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/layouts/:id
 * Update a layout's name. Admin only.
 */
router.put('/:id', authRequired, adminOnly, (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json(errorResponse('Invalid layout id'));
      return;
    }

    const input = updateLayoutSchema.parse(req.body);
    const layout = LayoutService.update(id, input);
    if (!layout) {
      res.status(404).json(errorResponse('Layout not found'));
      return;
    }

    res.json(successResponse(toPublicLayout(layout)));
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/layouts/:id
 * Delete a layout (and its image file). Admin only.
 */
router.delete('/:id', authRequired, adminOnly, (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json(errorResponse('Invalid layout id'));
    return;
  }

  const deleted = LayoutService.delete(id);
  if (!deleted) {
    res.status(404).json(errorResponse('Layout not found'));
    return;
  }

  res.json(successResponse({ deleted: true }));
});

/**
 * POST /api/layouts/:id/image
 * Upload a floor-plan image as a RAW image body. Admin only.
 * express.raw is registered ONLY on this route so the global JSON parser is
 * bypassed for image bodies.
 */
router.post(
  '/:id/image',
  authRequired,
  adminOnly,
  express.raw({
    type: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    limit: RAW_IMAGE_LIMIT,
  }),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parsePositiveInt(req.params.id);
      if (id === null) {
        res.status(400).json(errorResponse('Invalid layout id'));
        return;
      }

      const layout = LayoutService.findById(id);
      if (!layout) {
        res.status(404).json(errorResponse('Layout not found'));
        return;
      }

      const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (contentType === 'image/svg+xml') {
        res.status(400).json(errorResponse('SVG uploads are not permitted'));
        return;
      }
      const ext = IMAGE_EXT_BY_MIME[contentType];
      if (!ext) {
        res.status(400).json(errorResponse('Unsupported image type. Allowed: PNG, JPEG, WEBP, GIF'));
        return;
      }

      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json(errorResponse('Empty image body'));
        return;
      }

      const dir = ensureLayoutsDir();
      const filename = `${id}.${ext}`;

      // Remove a previous image with a different extension so it isn't orphaned.
      if (layout.image_path && layout.image_path !== filename) {
        try {
          const old = layoutImagePath(layout.image_path);
          if (fs.existsSync(old)) fs.unlinkSync(old);
        } catch {
          /* best-effort cleanup */
        }
      }

      fs.writeFileSync(`${dir}/${filename}`, body);

      const updated = LayoutService.setImage(id, filename, contentType);
      res.json(successResponse(toPublicLayout(updated!)));
    } catch (err) {
      next(err);
    }
  },
);

// ── Placement routes (admin) ────────────────────────────────

/**
 * POST /api/layouts/:id/placements
 * Add a camera marker placement to a layout. Admin only.
 */
router.post(
  '/:id/placements',
  authRequired,
  adminOnly,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parsePositiveInt(req.params.id);
      if (id === null) {
        res.status(400).json(errorResponse('Invalid layout id'));
        return;
      }

      const layout = LayoutService.findById(id);
      if (!layout) {
        res.status(404).json(errorResponse('Layout not found'));
        return;
      }

      const input = createPlacementSchema.parse(req.body);
      const placement = LayoutService.addPlacement(id, input);
      res.status(201).json(successResponse(placement));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PUT /api/layouts/:id/placements/:pid
 * Update a placement's position/label. Admin only.
 */
router.put(
  '/:id/placements/:pid',
  authRequired,
  adminOnly,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const pid = parsePositiveInt(req.params.pid);
      if (pid === null) {
        res.status(400).json(errorResponse('Invalid placement id'));
        return;
      }

      const input = updatePlacementSchema.parse(req.body);
      const placement = LayoutService.updatePlacement(pid, input);
      if (!placement) {
        res.status(404).json(errorResponse('Placement not found'));
        return;
      }

      res.json(successResponse(placement));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /api/layouts/:id/placements/:pid
 * Remove a placement. Admin only.
 */
router.delete(
  '/:id/placements/:pid',
  authRequired,
  adminOnly,
  (req: Request, res: Response) => {
    const pid = parsePositiveInt(req.params.pid);
    if (pid === null) {
      res.status(400).json(errorResponse('Invalid placement id'));
      return;
    }

    const deleted = LayoutService.deletePlacement(pid);
    if (!deleted) {
      res.status(404).json(errorResponse('Placement not found'));
      return;
    }

    res.json(successResponse({ deleted: true }));
  },
);

export default router;
