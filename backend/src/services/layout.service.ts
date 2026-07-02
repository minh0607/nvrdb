import path from 'path';
import fs from 'fs';
import db from '../models/database.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import type {
  LayoutRow,
  PlacementRow,
  CreatePlacementInput,
  UpdatePlacementInput,
  CreateLayoutInput,
  UpdateLayoutInput,
} from '../models/schemas.js';

/**
 * Directory where floor-plan images are stored, alongside the SQLite DB file.
 * image_path stores only the filename (`<id>.<ext>`); the absolute path is
 * resolved through layoutsDir() so the DB stays portable.
 */
function layoutsDir(): string {
  return path.join(path.dirname(path.resolve(env.DATABASE_PATH)), 'layouts');
}

export function ensureLayoutsDir(): string {
  const dir = layoutsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Absolute path to a layout image given its stored filename.
 */
export function layoutImagePath(filename: string): string {
  const dir = layoutsDir();
  const resolved = path.resolve(dir, filename);
  // Containment guard: reject any filename that resolves outside the layouts dir
  // (path traversal, absolute paths, embedded separators).
  if (resolved !== path.join(dir, path.basename(filename))) {
    throw new Error(`Invalid layout image filename: ${filename}`);
  }
  return resolved;
}

/**
 * LayoutService manages floor-plan layouts, their image files, and the camera
 * marker placements positioned on them.
 */
export class LayoutService {
  // ── Layout CRUD ───────────────────────────────────────────

  static findAll(): LayoutRow[] {
    return db.prepare('SELECT * FROM layouts ORDER BY name').all() as LayoutRow[];
  }

  static findById(id: number): LayoutRow | undefined {
    return db.prepare('SELECT * FROM layouts WHERE id = ?').get(id) as LayoutRow | undefined;
  }

  static create(input: CreateLayoutInput): LayoutRow {
    const result = db
      .prepare('INSERT INTO layouts (name, area_id) VALUES (?, ?)')
      .run(input.name, input.area_id ?? null);
    const layout = this.findById(result.lastInsertRowid as number)!;
    logger.info({ layoutId: layout.id, name: layout.name }, 'Layout created');
    return layout;
  }

  static update(id: number, input: UpdateLayoutInput): LayoutRow | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const name = input.name ?? existing.name;
    // undefined = leave unchanged; null = clear the stored frame aspect.
    const width = input.width !== undefined ? input.width : existing.width;
    const height = input.height !== undefined ? input.height : existing.height;
    // undefined = leave unchanged; null = ungroup (clear the area).
    const areaId = input.area_id !== undefined ? input.area_id : existing.area_id;

    db.prepare(`
      UPDATE layouts SET name = ?, width = ?, height = ?, area_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(name, width, height, areaId, id);

    logger.info({ layoutId: id }, 'Layout updated');
    return this.findById(id)!;
  }

  static delete(id: number): boolean {
    const existing = this.findById(id);
    if (!existing) return false;

    // Remove the image file from disk (best-effort) before deleting the row.
    if (existing.image_path) {
      const filePath = layoutImagePath(existing.image_path);
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (err) {
        logger.warn({ layoutId: id, error: err }, 'Failed to delete layout image file');
      }
    }

    db.prepare('DELETE FROM layouts WHERE id = ?').run(id);
    logger.info({ layoutId: id }, 'Layout deleted');
    return true;
  }

  static setImage(id: number, filename: string, mime: string): LayoutRow | null {
    const existing = this.findById(id);
    if (!existing) return null;

    db.prepare(`
      UPDATE layouts SET image_path = ?, image_mime = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(filename, mime, id);

    logger.info({ layoutId: id, filename }, 'Layout image set');
    return this.findById(id)!;
  }

  // ── Placement Operations ──────────────────────────────────

  static getPlacements(layoutId: number): PlacementRow[] {
    return db
      .prepare(
        `SELECT p.*, c.name AS camera_name
         FROM layout_placements p
         LEFT JOIN cameras c ON c.nvr_id = p.nvr_id AND c.channel = p.channel
         WHERE p.layout_id = ?
         ORDER BY p.id`,
      )
      .all(layoutId) as PlacementRow[];
  }

  static findPlacementById(pid: number): PlacementRow | undefined {
    return db
      .prepare(
        `SELECT p.*, c.name AS camera_name
         FROM layout_placements p
         LEFT JOIN cameras c ON c.nvr_id = p.nvr_id AND c.channel = p.channel
         WHERE p.id = ?`,
      )
      .get(pid) as PlacementRow | undefined;
  }

  static addPlacement(layoutId: number, input: CreatePlacementInput): PlacementRow {
    const result = db
      .prepare(`
        INSERT INTO layout_placements (layout_id, nvr_id, channel, label, x, y, view_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        layoutId,
        input.nvr_id,
        input.channel,
        input.label ?? null,
        input.x,
        input.y,
        input.view_mode ?? null,
      );

    const placement = this.findPlacementById(result.lastInsertRowid as number)!;
    logger.info({ layoutId, placementId: placement.id }, 'Placement added');
    return placement;
  }

  static updatePlacement(pid: number, input: UpdatePlacementInput): PlacementRow | null {
    const existing = this.findPlacementById(pid);
    if (!existing) return null;

    const x = input.x ?? existing.x;
    const y = input.y ?? existing.y;
    const label = input.label !== undefined ? input.label : existing.label;
    // undefined = leave unchanged; null = clear the per-camera override.
    const viewMode = input.view_mode !== undefined ? input.view_mode : existing.view_mode;

    db.prepare(`
      UPDATE layout_placements SET x = ?, y = ?, label = ?, view_mode = ? WHERE id = ?
    `).run(x, y, label, viewMode, pid);

    return this.findPlacementById(pid)!;
  }

  static deletePlacement(pid: number): boolean {
    const existing = this.findPlacementById(pid);
    if (!existing) return false;

    db.prepare('DELETE FROM layout_placements WHERE id = ?').run(pid);
    logger.info({ placementId: pid }, 'Placement deleted');
    return true;
  }
}
