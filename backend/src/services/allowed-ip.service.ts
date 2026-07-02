import db from '../models/database.js';
import { logger } from '../config/logger.js';
import type { AllowedIpRow, CreateAllowedIpInput } from '../models/schemas.js';

/**
 * AllowedIpService manages the IP allowlist that gates access to the whole app.
 *
 * The allowlist rows are cached in memory so the hot-path middleware (runs on
 * every request) doesn't hit SQLite each time. The cache is invalidated on any
 * mutation.
 */
export class AllowedIpService {
  private static cache: AllowedIpRow[] | null = null;

  private static rows(): AllowedIpRow[] {
    if (this.cache === null) {
      this.cache = db
        .prepare('SELECT * FROM allowed_ips ORDER BY id')
        .all() as AllowedIpRow[];
    }
    return this.cache;
  }

  private static invalidate(): void {
    this.cache = null;
  }

  static list(): AllowedIpRow[] {
    return this.rows();
  }

  static add(input: CreateAllowedIpInput): AllowedIpRow {
    const result = db
      .prepare('INSERT INTO allowed_ips (ip, label) VALUES (?, ?)')
      .run(input.ip, input.label ?? null);
    this.invalidate();
    const row = db
      .prepare('SELECT * FROM allowed_ips WHERE id = ?')
      .get(result.lastInsertRowid as number) as AllowedIpRow;
    logger.info({ id: row.id, ip: row.ip }, 'Allowed IP added');
    return row;
  }

  static delete(id: number): boolean {
    const result = db.prepare('DELETE FROM allowed_ips WHERE id = ?').run(id);
    if (result.changes === 0) return false;
    this.invalidate();
    logger.info({ id }, 'Allowed IP deleted');
    return true;
  }

  /**
   * Decide whether a client IP may reach the app.
   * - Empty allowlist → open by default (returns true).
   * - Loopback is always allowed (server-local admin never locked out).
   * - Otherwise the normalized IPv4 must match a row exactly or fall inside a
   *   row's CIDR range.
   */
  static isAllowed(clientIp: string): boolean {
    const ip = this.normalize(clientIp);

    if (ip === '127.0.0.1' || ip === '::1') return true;

    const rows = this.rows();
    if (rows.length === 0) return true;

    const clientLong = this.ipv4ToLong(ip);
    if (clientLong === null) return false;

    return rows.some((row) => this.matches(clientLong, row.ip));
  }

  /**
   * Strip a leading IPv4-mapped-IPv6 prefix (`::ffff:192.168.1.5` → `192.168.1.5`).
   */
  private static normalize(clientIp: string): string {
    const lower = clientIp.trim().toLowerCase();
    if (lower.startsWith('::ffff:')) return clientIp.trim().slice(7);
    return clientIp.trim();
  }

  /**
   * Convert a dotted-quad IPv4 string to an unsigned 32-bit number, or null if
   * it isn't a valid IPv4 address.
   */
  private static ipv4ToLong(ip: string): number | null {
    const octets = ip.split('.');
    if (octets.length !== 4) return null;
    let long = 0;
    for (const octet of octets) {
      if (!/^\d{1,3}$/.test(octet)) return null;
      const n = Number(octet);
      if (n < 0 || n > 255) return null;
      long = long * 256 + n;
    }
    // Use unsigned shift semantics; `>>> 0` keeps it a positive 32-bit integer.
    return long >>> 0;
  }

  /**
   * Test whether a client (as a 32-bit long) matches an allowlist entry, which
   * is either an exact IPv4 or an IPv4 CIDR (`base/prefix`).
   */
  private static matches(clientLong: number, entry: string): boolean {
    const [base, prefix] = entry.split('/');
    const baseLong = this.ipv4ToLong(base);
    if (baseLong === null) return false;

    if (prefix === undefined) {
      return clientLong === baseLong;
    }

    const bits = Number(prefix);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    // /0 matches everything; avoid a 32-bit shift which is undefined in JS.
    if (bits === 0) return true;
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return (clientLong & mask) === (baseLong & mask);
  }
}
