import db from '../models/database.js';
import { logger } from '../config/logger.js';
import type { AreaRow, CreateAreaInput, UpdateAreaInput } from '../models/schemas.js';

/**
 * AreaService manages grouping areas — a level above layouts. Deleting an area
 * ungroups its layouts (FK ON DELETE SET NULL) rather than deleting them.
 */
export class AreaService {
  static list(): AreaRow[] {
    return db.prepare('SELECT * FROM areas ORDER BY sort_order, id').all() as AreaRow[];
  }

  static findById(id: number): AreaRow | undefined {
    return db.prepare('SELECT * FROM areas WHERE id = ?').get(id) as AreaRow | undefined;
  }

  static create(input: CreateAreaInput): AreaRow {
    const result = db
      .prepare('INSERT INTO areas (name, sort_order) VALUES (?, ?)')
      .run(input.name, input.sort_order ?? 0);
    const area = this.findById(result.lastInsertRowid as number)!;
    logger.info({ areaId: area.id, name: area.name }, 'Area created');
    return area;
  }

  static update(id: number, input: UpdateAreaInput): AreaRow | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const name = input.name ?? existing.name;
    const sortOrder = input.sort_order ?? existing.sort_order;

    db.prepare('UPDATE areas SET name = ?, sort_order = ? WHERE id = ?').run(name, sortOrder, id);

    logger.info({ areaId: id }, 'Area updated');
    return this.findById(id)!;
  }

  static delete(id: number): boolean {
    const existing = this.findById(id);
    if (!existing) return false;

    // FK ON DELETE SET NULL ungroups this area's layouts (never deletes them).
    db.prepare('DELETE FROM areas WHERE id = ?').run(id);
    logger.info({ areaId: id }, 'Area deleted');
    return true;
  }
}
