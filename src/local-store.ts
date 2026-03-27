import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { logger } from './logger.js';

export interface CaptureRecord {
  id: string;
  type: 'screenshot' | 'window';
  timestamp: string;
  data: string; // base64 for screenshots, JSON for window info
  sent: boolean;
}

/**
 * Local SQLite store for captures that haven't been sent to the pipeline yet.
 * Acts as a buffer so captures aren't lost if the pipeline is unreachable.
 */
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
      sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_unsent ON captures (sent) WHERE sent = 0`);
    logger.info('Local capture store initialized');
  }

  insert(record: Omit<CaptureRecord, 'sent'>): void {
    this.db.prepare(
      `INSERT OR IGNORE INTO captures (id, type, timestamp, data) VALUES (?, ?, ?, ?)`,
    ).run(record.id, record.type, record.timestamp, record.data);
  }

  getUnsent(limit = 20): CaptureRecord[] {
    return this.db.prepare(
      `SELECT id, type, timestamp, data, sent FROM captures WHERE sent = 0 ORDER BY timestamp ASC LIMIT ?`,
    ).all(limit) as CaptureRecord[];
  }

  markSent(id: string): void {
    this.db.prepare(`UPDATE captures SET sent = 1 WHERE id = ?`).run(id);
  }

  /** Delete sent captures older than N days. */
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
