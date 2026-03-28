import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { logger } from './logger.js';

export interface CaptureRecord {
  id: string;
  type: 'screenshot';
  timestamp: string;
  data: string;
  metadata?: string;
  sent: number;
}

export class LocalStore {
  private db: BetterSqlite3.Database;

  constructor(dbPath = 'captures.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS captures (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      data TEXT NOT NULL,
      metadata TEXT,
      sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_unsent ON captures (sent) WHERE sent = 0`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_timestamp ON captures (timestamp DESC)`);
    logger.info('Local capture store initialized');
  }

  insert(record: Omit<CaptureRecord, 'sent'>): void {
    this.db.prepare(
      `INSERT OR IGNORE INTO captures (id, type, timestamp, data, metadata) VALUES (?, ?, ?, ?, ?)`,
    ).run(record.id, record.type, record.timestamp, record.data, record.metadata ?? null);
  }

  getUnsent(limit = 20): CaptureRecord[] {
    return this.db.prepare(
      `SELECT id, type, timestamp, data, metadata, sent FROM captures WHERE sent = 0 ORDER BY timestamp ASC LIMIT ?`,
    ).all(limit) as CaptureRecord[];
  }

  getRecent(limit = 20): CaptureRecord[] {
    return this.db.prepare(
      `SELECT id, type, timestamp, data, metadata, sent FROM captures ORDER BY timestamp DESC LIMIT ?`,
    ).all(limit) as CaptureRecord[];
  }

  getById(id: string): CaptureRecord | undefined {
    return this.db.prepare(
      `SELECT id, type, timestamp, data, metadata, sent FROM captures WHERE id = ?`,
    ).get(id) as CaptureRecord | undefined;
  }

  getStats(): { total: number; unsent: number; sent: number } {
    const row = this.db.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN sent = 0 THEN 1 ELSE 0 END) as unsent, SUM(CASE WHEN sent = 1 THEN 1 ELSE 0 END) as sent FROM captures`,
    ).get() as any;
    return { total: row.total, unsent: row.unsent ?? 0, sent: row.sent ?? 0 };
  }

  markSent(id: string): void {
    this.db.prepare(`UPDATE captures SET sent = 1 WHERE id = ?`).run(id);
  }

  purgeOlderThan(days: number): number {
    const result = this.db.prepare(
      `DELETE FROM captures WHERE sent = 1 AND created_at <= datetime('now', ?)`,
    ).run(`-${days} days`);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
