# Activity-Aware Capture Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed-interval capture system with an activity-aware one that captures smarter (on window change, idle→active, periodic fallback), enriches every capture with context metadata, and serves a local dashboard to preview captures before they hit the pipeline.

**Architecture:** ActivityMonitor replaces WindowTracker as the central orchestrator — it polls `active-win` + `desktop-idle`, maintains an idle/active state machine, tracks window durations, and triggers `ScreenshotCapture.captureNow()` with enriched metadata. A lightweight Fastify server on the desktop agent serves a live dashboard reading from LocalStore via WebSocket. No pipeline changes needed — enriched metadata flows through the existing `metadata` field.

**Tech Stack:** TypeScript, `active-win`, `desktop-idle`, `screenshot-desktop`, `better-sqlite3`, Fastify + `@fastify/websocket`, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/activity-monitor.ts` | Create | State machine (active↔idle), window polling, idle detection, duration tracking, capture triggering, metadata building |
| `src/screenshot-capture.ts` | Modify | Remove interval-based capture, expose `captureNow(): Promise<Buffer>` |
| `src/local-store.ts` | Modify | Add `metadata` column, add `getRecent(limit)`, `getById(id)`, `getStats()` for dashboard |
| `src/dashboard.ts` | Create | Fastify HTTP server + WebSocket for live capture preview |
| `src/dashboard.html` | Create | Single-file HTML/CSS/JS dashboard UI |
| `src/config.ts` | Modify | Add idle threshold, periodic interval, dashboard port config |
| `src/main.ts` | Modify | Wire ActivityMonitor, remove WindowTracker, start dashboard |
| `src/window-tracker.ts` | Delete | Absorbed into ActivityMonitor |
| `src/sender.ts` | Modify | Update payload mapping for enriched metadata |
| `tests/activity-monitor.test.ts` | Create | State machine, trigger logic, metadata building |
| `tests/screenshot-capture.test.ts` | Create | captureNow() contract |
| `tests/dashboard.test.ts` | Create | HTTP routes, WebSocket events |
| `tests/local-store.test.ts` | Modify | Add tests for metadata column, getRecent, getStats |
| `tests/sender.test.ts` | Modify | Update for enriched metadata payload |

---

## Chunk 1: ActivityMonitor + ScreenshotCapture refactor

### Task 1: Install new dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install desktop-idle, fastify, and @fastify/websocket**

```bash
cd ~/projects/knowledge-harvester-desktop
npm install desktop-idle fastify @fastify/websocket
```

- [ ] **Step 2: Verify install succeeded**

Run: `npm ls desktop-idle fastify @fastify/websocket`
Expected: All three listed with versions, no UNMET PEER

- [ ] **Step 3: Add type declaration for desktop-idle**

`desktop-idle` has no published types. Append to `src/types.d.ts`:

```typescript
declare module 'desktop-idle' {
  const desktopIdle: {
    getIdleTime(): number; // seconds since last user input
  };
  export default desktopIdle;
}
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/types.d.ts
git commit -m "deps: add desktop-idle, fastify, @fastify/websocket"
```

---

### Task 2: Refactor ScreenshotCapture to on-demand

**Files:**
- Modify: `src/screenshot-capture.ts`
- Create: `tests/screenshot-capture.test.ts`

- [ ] **Step 1: Write failing test for captureNow()**

```typescript
// tests/screenshot-capture.test.ts
import { describe, it, expect, vi } from 'vitest';

// Mock screenshot-desktop before import
vi.mock('screenshot-desktop', () => ({
  default: vi.fn().mockResolvedValue(Buffer.from('fake-jpeg')),
}));

import { ScreenshotCapture } from '../src/screenshot-capture.js';

describe('ScreenshotCapture', () => {
  it('captureNow() returns a Buffer', async () => {
    const capture = new ScreenshotCapture();
    const result = await capture.captureNow();
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('captureNow() returns null on failure', async () => {
    const screenshotMod = await import('screenshot-desktop');
    (screenshotMod.default as any).mockRejectedValueOnce(new Error('no display'));

    const capture = new ScreenshotCapture();
    const result = await capture.captureNow();
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/projects/knowledge-harvester-desktop && npx vitest run tests/screenshot-capture.test.ts`
Expected: FAIL — ScreenshotCapture constructor signature mismatch or captureNow not found

- [ ] **Step 3: Rewrite ScreenshotCapture as on-demand**

```typescript
// src/screenshot-capture.ts
import screenshot from 'screenshot-desktop';
import { logger } from './logger.js';

/**
 * On-demand screenshot capture. No longer runs on its own interval.
 * Called by ActivityMonitor when it decides a capture is needed.
 */
export class ScreenshotCapture {
  async captureNow(): Promise<Buffer | null> {
    try {
      const img = await screenshot({ format: 'jpg' });
      const buf = Buffer.isBuffer(img) ? img : Buffer.from(img);
      logger.debug({ size: buf.length }, 'Screenshot captured');
      return buf;
    } catch (err) {
      logger.error({ err }, 'Screenshot capture failed');
      return null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/projects/knowledge-harvester-desktop && npx vitest run tests/screenshot-capture.test.ts`
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
cd ~/projects/knowledge-harvester-desktop
git add src/screenshot-capture.ts tests/screenshot-capture.test.ts
git commit -m "refactor: make ScreenshotCapture on-demand with captureNow()"
```

---

### Task 3: Update config with new settings

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Add new config values**

```typescript
// src/config.ts
import 'dotenv/config';

export const config = {
  pipelineUrl: process.env.PIPELINE_URL ?? 'http://localhost:3001',
  userId: process.env.USER_ID ?? 'user-1',
  userEmail: process.env.USER_EMAIL ?? 'user@company.com',
  windowPollIntervalMs: parseInt(process.env.WINDOW_POLL_INTERVAL_MS ?? '1000', 10),
  idleThresholdMs: parseInt(process.env.IDLE_THRESHOLD_MS ?? '300000', 10), // 5 min
  periodicCaptureMs: parseInt(process.env.PERIODIC_CAPTURE_MS ?? '60000', 10), // 60s fallback
  dashboardPort: parseInt(process.env.DASHBOARD_PORT ?? '3333', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
```

Note: `screenshotIntervalMs` is removed — replaced by `periodicCaptureMs`.

- [ ] **Step 2: Commit**

```bash
cd ~/projects/knowledge-harvester-desktop
git add src/config.ts
git commit -m "config: add idle threshold, periodic capture, dashboard port"
```

---

### Task 4: Build ActivityMonitor

**Files:**
- Create: `src/activity-monitor.ts`
- Create: `tests/activity-monitor.test.ts`

- [ ] **Step 1: Write failing tests for ActivityMonitor**

```typescript
// tests/activity-monitor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock external dependencies
vi.mock('active-win', () => ({
  default: vi.fn().mockResolvedValue({
    title: 'main.ts - VS Code',
    owner: { name: 'Code' },
    url: undefined,
  }),
}));

vi.mock('desktop-idle', () => ({
  default: { getIdleTime: vi.fn().mockReturnValue(0) },
}));

import activeWin from 'active-win';
import desktopIdle from 'desktop-idle';
import { ActivityMonitor, type CaptureEvent, type ActivityState } from '../src/activity-monitor.js';

describe('ActivityMonitor', () => {
  let captures: CaptureEvent[];
  let monitor: ActivityMonitor;

  beforeEach(() => {
    captures = [];
    vi.clearAllMocks();
    monitor = new ActivityMonitor({
      windowPollMs: 100,
      idleThresholdMs: 5000,
      periodicCaptureMs: 60000,
      onCapture: (event) => captures.push(event),
    });
  });

  describe('state machine', () => {
    it('starts in active state', () => {
      expect(monitor.getState()).toBe('active');
    });

    it('transitions to idle when desktop-idle exceeds threshold', () => {
      (desktopIdle.getIdleTime as any).mockReturnValue(6); // 6 seconds > 5s threshold
      monitor.tick();
      expect(monitor.getState()).toBe('idle');
    });

    it('transitions back to active from idle', () => {
      (desktopIdle.getIdleTime as any).mockReturnValue(6);
      monitor.tick();
      expect(monitor.getState()).toBe('idle');

      (desktopIdle.getIdleTime as any).mockReturnValue(0);
      monitor.tick();
      expect(monitor.getState()).toBe('active');
    });
  });

  describe('capture triggers', () => {
    it('triggers capture on window change', async () => {
      // First tick establishes baseline
      await monitor.tick();
      expect(captures).toHaveLength(0); // first window, no "change" yet

      // Change window
      (activeWin as any).mockResolvedValue({
        title: 'Chrome - Google',
        owner: { name: 'chrome' },
        url: 'https://google.com',
      });
      await monitor.tick();
      expect(captures).toHaveLength(1);
      expect(captures[0].triggerReason).toBe('window_change');
      expect(captures[0].previousWindow).toEqual({ title: 'main.ts - VS Code', owner: 'Code' });
    });

    it('triggers capture on idle-to-active transition', async () => {
      // Establish active state
      await monitor.tick();

      // Go idle
      (desktopIdle.getIdleTime as any).mockReturnValue(6);
      await monitor.tick();

      // Come back
      (desktopIdle.getIdleTime as any).mockReturnValue(0);
      await monitor.tick();
      const idleCapture = captures.find(c => c.triggerReason === 'idle_to_active');
      expect(idleCapture).toBeDefined();
    });

    it('does NOT trigger capture while idle', async () => {
      await monitor.tick(); // establish baseline
      captures.length = 0;

      (desktopIdle.getIdleTime as any).mockReturnValue(6);
      await monitor.tick(); // idle transition
      await monitor.tick(); // still idle
      await monitor.tick(); // still idle

      // No captures during sustained idle
      expect(captures).toHaveLength(0);
    });
  });

  describe('metadata enrichment', () => {
    it('extracts document name from window title', async () => {
      (activeWin as any).mockResolvedValue({
        title: 'ROV-123-inspection.xlsx - Excel',
        owner: { name: 'EXCEL' },
      });
      await monitor.tick(); // baseline
      (activeWin as any).mockResolvedValue({
        title: 'Chrome - Google',
        owner: { name: 'chrome' },
      });
      await monitor.tick(); // trigger

      expect(captures[0].documentName).toBe('ROV-123-inspection.xlsx');
    });

    it('classifies app categories', async () => {
      (activeWin as any).mockResolvedValue({
        title: 'test - Code',
        owner: { name: 'Code' },
      });
      await monitor.tick();

      (activeWin as any).mockResolvedValue({
        title: 'Google - Chrome',
        owner: { name: 'chrome' },
      });
      await monitor.tick();
      expect(captures[0].appCategory).toBe('browser');
    });

    it('tracks duration in previous window', async () => {
      await monitor.tick(); // baseline at t=0

      // Simulate 5 seconds passing
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);

      (activeWin as any).mockResolvedValue({
        title: 'Other',
        owner: { name: 'other' },
      });
      await monitor.tick();
      expect(captures[0].durationSeconds).toBeGreaterThanOrEqual(4);
      expect(captures[0].durationSeconds).toBeLessThanOrEqual(6);

      vi.restoreAllMocks();
    });

    it('builds session context from recent windows', async () => {
      const windows = [
        { title: 'File A - Code', owner: { name: 'Code' } },
        { title: 'Chrome - Docs', owner: { name: 'chrome' } },
        { title: 'Teams - Chat', owner: { name: 'Teams' } },
        { title: 'File B - Code', owner: { name: 'Code' } },
      ];

      for (const win of windows) {
        (activeWin as any).mockResolvedValue(win);
        await monitor.tick();
      }

      const lastCapture = captures[captures.length - 1];
      expect(lastCapture.sessionContext.length).toBeGreaterThanOrEqual(2);
      expect(lastCapture.sessionContext.length).toBeLessThanOrEqual(5);
    });

    it('increments captureSequence', async () => {
      await monitor.tick();
      (activeWin as any).mockResolvedValue({ title: 'B', owner: { name: 'b' } });
      await monitor.tick();
      (activeWin as any).mockResolvedValue({ title: 'C', owner: { name: 'c' } });
      await monitor.tick();

      expect(captures[0].captureSequence).toBe(1);
      expect(captures[1].captureSequence).toBe(2);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/projects/knowledge-harvester-desktop && npx vitest run tests/activity-monitor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ActivityMonitor**

```typescript
// src/activity-monitor.ts
import activeWin from 'active-win';
import desktopIdle from 'desktop-idle';
import { logger } from './logger.js';

export type ActivityState = 'active' | 'idle';
export type TriggerReason = 'window_change' | 'idle_to_active' | 'periodic' | 'initial';
export type AppCategory = 'editor' | 'browser' | 'communication' | 'document' | 'terminal' | 'other';

export interface CaptureEvent {
  triggerReason: TriggerReason;
  windowTitle: string;
  windowOwner: string;
  browserUrl?: string;
  documentName?: string;
  appCategory: AppCategory;
  durationSeconds: number;
  idleSeconds: number;
  previousWindow: { title: string; owner: string } | null;
  sessionContext: Array<{ title: string; owner: string; durationSeconds: number }>;
  captureSequence: number;
  capturedAt: string;
}

interface WindowState {
  title: string;
  owner: string;
  url?: string;
  enteredAt: number; // Date.now()
}

interface ActivityMonitorOptions {
  windowPollMs: number;
  idleThresholdMs: number;
  periodicCaptureMs: number;
  onCapture: (event: CaptureEvent) => void;
}

const APP_CATEGORIES: Record<string, AppCategory> = {
  code: 'editor', 'visual studio code': 'editor', vim: 'editor', neovim: 'editor',
  notepad: 'editor', 'notepad++': 'editor', sublime: 'editor',
  chrome: 'browser', firefox: 'browser', edge: 'browser', msedge: 'browser',
  brave: 'browser', safari: 'browser', opera: 'browser',
  teams: 'communication', slack: 'communication', outlook: 'communication',
  discord: 'communication', zoom: 'communication', skype: 'communication',
  excel: 'document', word: 'document', powerpoint: 'document',
  acrobat: 'document', 'adobe reader': 'document', libreoffice: 'document',
  'windows terminal': 'terminal', 'command prompt': 'terminal', cmd: 'terminal',
  powershell: 'terminal', 'git bash': 'terminal', wt: 'terminal', alacritty: 'terminal',
  windowsterminal: 'terminal',
};

// Common file extensions to extract from window titles
const DOC_PATTERN = /[\w\-. ]+\.(xlsx?|docx?|pptx?|pdf|csv|txt|md|ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|json|yaml|yml|xml|html|css|sql|sh|ps1)/i;

export class ActivityMonitor {
  private state: ActivityState = 'active';
  private currentWindow: WindowState | null = null;
  private previousWindow: { title: string; owner: string } | null = null;
  private sessionHistory: Array<{ title: string; owner: string; durationSeconds: number }> = [];
  private captureSequence = 0;
  private lastPeriodicCapture = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private opts: ActivityMonitorOptions;

  constructor(opts: ActivityMonitorOptions) {
    this.opts = opts;
  }

  getState(): ActivityState {
    return this.state;
  }

  getCurrentWindow(): WindowState | null {
    return this.currentWindow;
  }

  start(): void {
    logger.info({
      windowPollMs: this.opts.windowPollMs,
      idleThresholdMs: this.opts.idleThresholdMs,
      periodicCaptureMs: this.opts.periodicCaptureMs,
    }, 'Activity monitor started');
    this.interval = setInterval(() => this.tick(), this.opts.windowPollMs);
    this.tick();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    logger.info('Activity monitor stopped');
  }

  async tick(): Promise<void> {
    try {
      const idleSeconds = desktopIdle.getIdleTime();
      const wasIdle = this.state === 'idle';
      const isIdle = (idleSeconds * 1000) >= this.opts.idleThresholdMs;
      this.state = isIdle ? 'idle' : 'active';

      // Don't poll windows or capture while idle
      if (isIdle) return;

      const win = await activeWin();
      if (!win) return;

      const title = win.title ?? '';
      const owner = win.owner?.name ?? '';
      const url = (win as any).url as string | undefined;
      const now = Date.now();

      // First window ever
      if (!this.currentWindow) {
        this.currentWindow = { title, owner, url, enteredAt: now };
        this.lastPeriodicCapture = now;
        return;
      }

      const windowChanged = title !== this.currentWindow.title;
      const idleToActive = wasIdle && !isIdle;
      const periodicDue = (now - this.lastPeriodicCapture) >= this.opts.periodicCaptureMs;

      let triggerReason: TriggerReason | null = null;
      if (windowChanged) triggerReason = 'window_change';
      else if (idleToActive) triggerReason = 'idle_to_active';
      else if (periodicDue) triggerReason = 'periodic';

      if (!triggerReason) return;

      // Build capture event from CURRENT window state (what we're leaving or checking in on)
      const durationSeconds = Math.round((now - this.currentWindow.enteredAt) / 1000);

      const event: CaptureEvent = {
        triggerReason,
        windowTitle: this.currentWindow.title,
        windowOwner: this.currentWindow.owner,
        browserUrl: this.currentWindow.url,
        documentName: extractDocumentName(this.currentWindow.title),
        appCategory: classifyApp(this.currentWindow.owner),
        durationSeconds,
        idleSeconds,
        previousWindow: this.previousWindow,
        sessionContext: [...this.sessionHistory].slice(-5),
        captureSequence: ++this.captureSequence,
        capturedAt: new Date().toISOString(),
      };

      this.opts.onCapture(event);
      this.lastPeriodicCapture = now;

      // Update state for window changes
      if (windowChanged) {
        this.sessionHistory.push({
          title: this.currentWindow.title,
          owner: this.currentWindow.owner,
          durationSeconds,
        });
        if (this.sessionHistory.length > 10) this.sessionHistory.shift();

        this.previousWindow = { title: this.currentWindow.title, owner: this.currentWindow.owner };
        this.currentWindow = { title, owner, url, enteredAt: now };
      }
    } catch (err) {
      logger.error({ err }, 'Activity monitor tick failed');
    }
  }
}

export function classifyApp(owner: string): AppCategory {
  const lower = owner.toLowerCase();
  for (const [key, category] of Object.entries(APP_CATEGORIES)) {
    if (lower.includes(key)) return category;
  }
  return 'other';
}

export function extractDocumentName(title: string): string | undefined {
  const match = title.match(DOC_PATTERN);
  return match ? match[0].trim() : undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/projects/knowledge-harvester-desktop && npx vitest run tests/activity-monitor.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd ~/projects/knowledge-harvester-desktop
git add src/activity-monitor.ts tests/activity-monitor.test.ts
git commit -m "feat: ActivityMonitor with idle detection, window tracking, metadata enrichment"
```

---

### Task 5: Update LocalStore for metadata and dashboard queries

**Files:**
- Modify: `src/local-store.ts`
- Modify: `tests/local-store.test.ts`

- [ ] **Step 1: Write failing tests for new LocalStore features**

Append these tests **inside the existing `describe('LocalStore', () => { ... })` block**, before the closing `});`:

```typescript
// Append inside the describe('LocalStore') block in tests/local-store.test.ts

  it('stores and retrieves metadata', () => {
    store.insert({
      id: 'cap-1',
      type: 'screenshot',
      timestamp: '2026-03-28T10:00:00Z',
      data: 'base64data',
      metadata: JSON.stringify({ triggerReason: 'window_change', appCategory: 'editor' }),
    });

    const unsent = store.getUnsent();
    expect(unsent[0].metadata).toBe(JSON.stringify({ triggerReason: 'window_change', appCategory: 'editor' }));
  });

  it('getRecent returns captures in reverse chronological order', () => {
    store.insert({ id: 'cap-1', type: 'screenshot', timestamp: '2026-03-28T10:00:00Z', data: 'a' });
    store.insert({ id: 'cap-2', type: 'screenshot', timestamp: '2026-03-28T10:01:00Z', data: 'b' });
    store.insert({ id: 'cap-3', type: 'screenshot', timestamp: '2026-03-28T10:02:00Z', data: 'c' });

    const recent = store.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].id).toBe('cap-3'); // newest first
    expect(recent[1].id).toBe('cap-2');
  });

  it('getById returns a single capture', () => {
    store.insert({ id: 'cap-1', type: 'screenshot', timestamp: '2026-03-28T10:00:00Z', data: 'test' });
    const found = store.getById('cap-1');
    expect(found).toBeDefined();
    expect(found!.id).toBe('cap-1');
    expect(store.getById('nonexistent')).toBeUndefined();
  });

  it('getStats returns capture counts', () => {
    store.insert({ id: 'cap-1', type: 'screenshot', timestamp: '2026-03-28T10:00:00Z', data: 'a' });
    store.insert({ id: 'cap-2', type: 'screenshot', timestamp: '2026-03-28T10:01:00Z', data: 'b' });
    store.markSent('cap-1');

    const stats = store.getStats();
    expect(stats.total).toBe(2);
    expect(stats.unsent).toBe(1);
    expect(stats.sent).toBe(1);
  });
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `cd ~/projects/knowledge-harvester-desktop && npx vitest run tests/local-store.test.ts`
Expected: New tests FAIL (metadata column doesn't exist, getRecent/getStats not defined)

- [ ] **Step 3: Update LocalStore implementation**

```typescript
// src/local-store.ts
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { logger } from './logger.js';

export interface CaptureRecord {
  id: string;
  type: 'screenshot';
  timestamp: string;
  data: string;
  metadata?: string;
  sent: boolean;
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
```

- [ ] **Step 4: Run all LocalStore tests**

Run: `cd ~/projects/knowledge-harvester-desktop && npx vitest run tests/local-store.test.ts`
Expected: All tests PASS (old + new)

- [ ] **Step 5: Commit**

```bash
cd ~/projects/knowledge-harvester-desktop
git add src/local-store.ts tests/local-store.test.ts
git commit -m "feat: add metadata column, getRecent, getById, getStats to LocalStore"
```

---

### Task 6: Update Sender for enriched metadata

**Files:**
- Modify: `src/sender.ts`
- Modify: `tests/sender.test.ts`

- [ ] **Step 1: Write updated sender tests first**

```typescript
// tests/sender.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalStore } from '../src/local-store.js';
import { Sender } from '../src/sender.js';
import { existsSync, unlinkSync } from 'node:fs';

const TEST_DB = 'test-sender.db';

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = TEST_DB + suffix;
    if (existsSync(path)) unlinkSync(path);
  }
}

describe('Sender', () => {
  let store: LocalStore;

  beforeEach(() => {
    cleanup();
    store = new LocalStore(TEST_DB);
  });

  afterEach(() => {
    store.close();
    cleanup();
  });

  it('drains unsent captures with enriched metadata', async () => {
    store.insert({
      id: 'cap-1',
      type: 'screenshot',
      timestamp: '2026-03-28T10:00:00Z',
      data: '{"screenshotBase64":"abc"}',
      metadata: JSON.stringify({ triggerReason: 'window_change', appCategory: 'editor' }),
    });

    const mockClient = { sendCapture: vi.fn().mockResolvedValue(true) };
    const sender = new Sender(store, mockClient as any, 100000);
    await (sender as any).drain();

    expect(mockClient.sendCapture).toHaveBeenCalledTimes(1);
    const payload = mockClient.sendCapture.mock.calls[0][0];
    expect(payload.metadata.triggerReason).toBe('window_change');
    expect(payload.metadata.appCategory).toBe('editor');
    expect(payload.sourceType).toBe('desktop_screenshot');
    expect(store.getUnsent()).toHaveLength(0);
  });

  it('stops draining on pipeline failure', async () => {
    store.insert({ id: 'cap-1', type: 'screenshot', timestamp: '2026-03-28T10:00:00Z', data: 'a' });
    store.insert({ id: 'cap-2', type: 'screenshot', timestamp: '2026-03-28T10:00:01Z', data: 'b' });

    const mockClient = { sendCapture: vi.fn().mockResolvedValue(false) };
    const sender = new Sender(store, mockClient as any, 100000);
    await (sender as any).drain();

    expect(mockClient.sendCapture).toHaveBeenCalledTimes(1);
    expect(store.getUnsent()).toHaveLength(2);
  });

  it('does nothing when store is empty', async () => {
    const mockClient = { sendCapture: vi.fn().mockResolvedValue(true) };
    const sender = new Sender(store, mockClient as any, 100000);
    await (sender as any).drain();
    expect(mockClient.sendCapture).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify the metadata assertion fails**

Run: `cd ~/projects/knowledge-harvester-desktop && npx vitest run tests/sender.test.ts`
Expected: FAIL — metadata.triggerReason is undefined (old sender doesn't merge metadata)

- [ ] **Step 3: Update Sender implementation to pass metadata through**

```typescript
// src/sender.ts
import { logger } from './logger.js';
import type { LocalStore } from './local-store.js';
import type { PipelineClient, RawCapturePayload } from './pipeline-client.js';
import { config } from './config.js';

export class Sender {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private store: LocalStore,
    private client: PipelineClient,
    private drainIntervalMs = 5000,
  ) {}

  start(): void {
    logger.info({ drainIntervalMs: this.drainIntervalMs }, 'Sender started');
    this.interval = setInterval(() => this.drain(), this.drainIntervalMs);
    this.drain();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async drain(): Promise<void> {
    const unsent = this.store.getUnsent(10);
    if (unsent.length === 0) return;

    for (const record of unsent) {
      const metadata: Record<string, unknown> = { captureType: record.type };

      // Merge enriched metadata from ActivityMonitor
      if (record.metadata) {
        try {
          Object.assign(metadata, JSON.parse(record.metadata));
        } catch { /* ignore malformed metadata */ }
      }

      const payload: RawCapturePayload = {
        id: record.id,
        userId: config.userId,
        userEmail: config.userEmail,
        sourceType: 'desktop_screenshot',
        sourceApp: 'knowledge-harvester-desktop',
        capturedAt: record.timestamp,
        rawContent: record.data,
        metadata,
      };

      const success = await this.client.sendCapture(payload);
      if (success) {
        this.store.markSent(record.id);
      } else {
        logger.warn('Pipeline unreachable, will retry next drain cycle');
        break;
      }
    }
  }
}
```

- [ ] **Step 4: Run all tests**

Run: `cd ~/projects/knowledge-harvester-desktop && npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd ~/projects/knowledge-harvester-desktop
git add src/sender.ts tests/sender.test.ts
git commit -m "refactor: sender passes enriched metadata to pipeline"
```

---

## Chunk 2: Local Dashboard + Main Wiring

### Task 7: Build the dashboard server

**Files:**
- Create: `src/dashboard.ts`
- Create: `src/dashboard.html`
- Create: `tests/dashboard.test.ts`

- [ ] **Step 1: Write failing tests for dashboard HTTP routes**

```typescript
// tests/dashboard.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { LocalStore } from '../src/local-store.js';
import { buildDashboard } from '../src/dashboard.js';
import { existsSync, unlinkSync } from 'node:fs';

const TEST_DB = 'test-dashboard.db';

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = TEST_DB + suffix;
    if (existsSync(path)) unlinkSync(path);
  }
}

describe('Dashboard', () => {
  let store: LocalStore;
  let app: Awaited<ReturnType<typeof buildDashboard>>;

  beforeEach(async () => {
    cleanup();
    store = new LocalStore(TEST_DB);
    app = await buildDashboard(store);
  });

  afterEach(async () => {
    await app.close();
    store.close();
    cleanup();
  });

  it('GET / returns HTML', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Knowledge Harvester');
  });

  it('GET /api/recent returns recent captures', async () => {
    store.insert({
      id: 'cap-1',
      type: 'screenshot',
      timestamp: '2026-03-28T10:00:00Z',
      data: '{"screenshotBase64":"abc"}',
      metadata: JSON.stringify({ triggerReason: 'window_change' }),
    });

    const res = await app.inject({ method: 'GET', url: '/api/recent' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('cap-1');
  });

  it('GET /api/stats returns capture statistics', async () => {
    store.insert({ id: 'cap-1', type: 'screenshot', timestamp: '2026-03-28T10:00:00Z', data: 'a' });
    store.insert({ id: 'cap-2', type: 'screenshot', timestamp: '2026-03-28T10:01:00Z', data: 'b' });
    store.markSent('cap-1');

    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(2);
    expect(body.unsent).toBe(1);
    expect(body.sent).toBe(1);
  });

  it('GET /api/state returns activity state', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/state' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('state');
    expect(body).toHaveProperty('currentWindow');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/projects/knowledge-harvester-desktop && npx vitest run tests/dashboard.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create dashboard server**

```typescript
// src/dashboard.ts
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { LocalStore } from './local-store.js';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface DashboardState {
  state: string;
  currentWindow: { title: string; owner: string } | null;
}

let activityState: DashboardState = { state: 'active', currentWindow: null };
const wsClients = new Set<WebSocket>();

export function updateDashboardState(newState: DashboardState): void {
  activityState = newState;
}

export function broadcastCapture(capture: Record<string, unknown>): void {
  const msg = JSON.stringify({ type: 'capture', data: capture });
  for (const ws of wsClients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

export async function buildDashboard(store: LocalStore): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(websocket);

  // Serve dashboard HTML
  app.get('/', async (_req, reply) => {
    const html = readFileSync(join(__dirname, 'dashboard.html'), 'utf-8');
    reply.type('text/html').send(html);
  });

  // Recent captures (without base64 screenshot data for speed)
  app.get('/api/recent', async () => {
    const records = store.getRecent(50);
    return records.map(r => {
      let parsedData: any = {};
      try { parsedData = JSON.parse(r.data); } catch { /* raw string */ }
      const { screenshotBase64, ...dataWithoutScreenshot } = parsedData;
      let parsedMeta: any = {};
      try { if (r.metadata) parsedMeta = JSON.parse(r.metadata); } catch { /* ignore */ }
      return {
        id: r.id,
        type: r.type,
        timestamp: r.timestamp,
        data: dataWithoutScreenshot,
        metadata: parsedMeta,
        sent: r.sent,
        hasScreenshot: !!screenshotBase64,
      };
    });
  });

  // Capture stats
  app.get('/api/stats', async () => store.getStats());

  // Activity state
  app.get('/api/state', async () => activityState);

  // Screenshot image by capture ID
  app.get<{ Params: { id: string } }>('/api/screenshot/:id', async (req, reply) => {
    const record = store.getById(req.params.id);
    if (!record) { reply.code(404).send('Not found'); return; }
    try {
      const parsed = JSON.parse(record.data);
      if (!parsed.screenshotBase64) { reply.code(404).send('No screenshot'); return; }
      const buf = Buffer.from(parsed.screenshotBase64, 'base64');
      reply.type('image/jpeg').send(buf);
    } catch {
      reply.code(500).send('Parse error');
    }
  });

  // WebSocket for live updates
  app.get('/ws', { websocket: true }, (socket) => {
    wsClients.add(socket);
    socket.on('close', () => wsClients.delete(socket));
  });

  return app;
}
```

- [ ] **Step 4: Create dashboard HTML**

```html
<!-- src/dashboard.html -->
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Knowledge Harvester — Desktop Agent</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px; }
  h1 { font-size: 1.4em; color: #a5b4fc; margin-bottom: 4px; }
  .subtitle { color: #64748b; font-size: 0.85em; margin-bottom: 20px; }

  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  .stat { background: #1e293b; border-radius: 8px; padding: 16px; text-align: center; }
  .stat .value { font-size: 2em; font-weight: 700; color: #6366f1; }
  .stat .label { font-size: 0.75em; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .stat.active .value { color: #22c55e; }
  .stat.idle .value { color: #f59e0b; }

  .current-window { background: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 20px; border-left: 4px solid #6366f1; }
  .current-window .title { font-size: 1.1em; color: #f1f5f9; }
  .current-window .owner { color: #94a3b8; font-size: 0.85em; }

  .feed { display: flex; flex-direction: column; gap: 8px; }
  .capture { background: #1e293b; border-radius: 8px; padding: 12px 16px; display: flex; gap: 16px; align-items: center; cursor: pointer; transition: background 0.15s; }
  .capture:hover { background: #334155; }
  .capture .time { color: #64748b; font-size: 0.8em; min-width: 80px; }
  .capture .trigger { font-size: 0.7em; padding: 2px 8px; border-radius: 12px; font-weight: 600; }
  .trigger.window_change { background: #312e81; color: #a5b4fc; }
  .trigger.idle_to_active { background: #422006; color: #fbbf24; }
  .trigger.periodic { background: #052e16; color: #4ade80; }
  .capture .info { flex: 1; }
  .capture .window-title { color: #e2e8f0; font-size: 0.9em; }
  .capture .meta { color: #64748b; font-size: 0.75em; margin-top: 2px; }
  .capture .duration { color: #94a3b8; font-size: 0.8em; min-width: 60px; text-align: right; }
  .capture .sent-badge { font-size: 0.65em; padding: 2px 6px; border-radius: 8px; }
  .sent-badge.yes { background: #052e16; color: #4ade80; }
  .sent-badge.no { background: #1e293b; color: #64748b; border: 1px solid #334155; }
  .capture .screenshot-thumb { width: 80px; height: 45px; object-fit: cover; border-radius: 4px; border: 1px solid #334155; }

  .section-title { color: #94a3b8; font-size: 0.75em; text-transform: uppercase; letter-spacing: 1px; margin: 16px 0 8px; }

  .screenshot-modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.85); z-index: 100; align-items: center; justify-content: center; }
  .screenshot-modal.open { display: flex; }
  .screenshot-modal img { max-width: 90vw; max-height: 90vh; border-radius: 8px; }
</style>
</head>
<body>
  <h1>Knowledge Harvester — Desktop Agent</h1>
  <p class="subtitle">Activity-aware capture preview</p>

  <div class="stats">
    <div class="stat" id="stat-state"><div class="value" id="state-value">--</div><div class="label">State</div></div>
    <div class="stat"><div class="value" id="total-value">--</div><div class="label">Total Captures</div></div>
    <div class="stat"><div class="value" id="queued-value">--</div><div class="label">Queued</div></div>
    <div class="stat"><div class="value" id="sent-value">--</div><div class="label">Sent</div></div>
  </div>

  <div class="current-window" id="current-window">
    <div class="title" id="cw-title">Waiting for data...</div>
    <div class="owner" id="cw-owner"></div>
  </div>

  <div class="section-title">Recent Captures</div>
  <div class="feed" id="feed"></div>

  <div class="screenshot-modal" id="modal" onclick="this.classList.remove('open')">
    <img id="modal-img" src="">
  </div>

<script>
  const feed = document.getElementById('feed');
  const modal = document.getElementById('modal');
  const modalImg = document.getElementById('modal-img');

  function fmt(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function fmtDuration(s) {
    if (!s && s !== 0) return '';
    if (s < 60) return s + 's';
    return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  }

  function renderCapture(c) {
    const meta = c.metadata || {};
    const div = document.createElement('div');
    div.className = 'capture';
    div.innerHTML = `
      ${c.hasScreenshot ? `<img class="screenshot-thumb" src="/api/screenshot/${c.id}" loading="lazy" onclick="event.stopPropagation(); showScreenshot('${c.id}')">` : ''}
      <div class="time">${fmt(c.timestamp)}</div>
      <span class="trigger ${meta.triggerReason || ''}">${meta.triggerReason || c.type}</span>
      <div class="info">
        <div class="window-title">${meta.windowOwner || ''} ${meta.documentName ? '— ' + meta.documentName : (c.data?.windowTitle || '')}</div>
        <div class="meta">${meta.appCategory || ''} ${meta.browserUrl ? '· ' + meta.browserUrl : ''} ${meta.sessionContext ? '· ctx: ' + meta.sessionContext.length + ' windows' : ''}</div>
      </div>
      <div class="duration">${fmtDuration(meta.durationSeconds)}</div>
      <span class="sent-badge ${c.sent ? 'yes' : 'no'}">${c.sent ? 'sent' : 'queued'}</span>
    `;
    if (c.hasScreenshot) div.onclick = () => showScreenshot(c.id);
    return div;
  }

  function showScreenshot(id) {
    modalImg.src = '/api/screenshot/' + id;
    modal.classList.add('open');
  }

  async function refresh() {
    const [recentRes, statsRes, stateRes] = await Promise.all([
      fetch('/api/recent'), fetch('/api/stats'), fetch('/api/state')
    ]);
    const recent = await recentRes.json();
    const stats = await statsRes.json();
    const state = await stateRes.json();

    document.getElementById('state-value').textContent = state.state;
    const statEl = document.getElementById('stat-state');
    statEl.className = 'stat ' + state.state;
    document.getElementById('total-value').textContent = stats.total;
    document.getElementById('queued-value').textContent = stats.unsent;
    document.getElementById('sent-value').textContent = stats.sent;

    if (state.currentWindow) {
      document.getElementById('cw-title').textContent = state.currentWindow.title;
      document.getElementById('cw-owner').textContent = state.currentWindow.owner;
    }

    feed.innerHTML = '';
    for (const c of recent) feed.appendChild(renderCapture(c));
  }

  // WebSocket for live updates
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = () => refresh();
  ws.onclose = () => setTimeout(() => location.reload(), 3000);

  // Initial load + periodic fallback
  refresh();
  setInterval(refresh, 5000);
</script>
</body>
</html>
```

- [ ] **Step 5: Run dashboard tests**

Run: `cd ~/projects/knowledge-harvester-desktop && npx vitest run tests/dashboard.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
cd ~/projects/knowledge-harvester-desktop
git add src/dashboard.ts src/dashboard.html tests/dashboard.test.ts
git commit -m "feat: local dashboard server for live capture preview"
```

---

### Task 8: Wire everything in main.ts and delete window-tracker.ts

**Files:**
- Modify: `src/main.ts`
- Delete: `src/window-tracker.ts`

- [ ] **Step 1: Rewrite main.ts**

```typescript
// src/main.ts
import { config } from './config.js';
import { logger } from './logger.js';
import { ActivityMonitor, type CaptureEvent } from './activity-monitor.js';
import { ScreenshotCapture } from './screenshot-capture.js';
import { LocalStore } from './local-store.js';
import { PipelineClient } from './pipeline-client.js';
import { Sender } from './sender.js';
import { buildDashboard, updateDashboardState, broadcastCapture } from './dashboard.js';
import { v4 as uuid } from 'uuid';

async function main(): Promise<void> {
  logger.info({ userId: config.userId, pipelineUrl: config.pipelineUrl }, 'Knowledge Harvester Desktop Agent starting');

  const store = new LocalStore('captures.db');
  const client = new PipelineClient(config.pipelineUrl);
  const sender = new Sender(store, client);
  const screenshotCapture = new ScreenshotCapture();

  const monitor = new ActivityMonitor({
    windowPollMs: config.windowPollIntervalMs,
    idleThresholdMs: config.idleThresholdMs,
    periodicCaptureMs: config.periodicCaptureMs,
    onCapture: async (event: CaptureEvent) => {
      const buf = await screenshotCapture.captureNow();
      if (!buf) return;

      const captureData = {
        windowTitle: event.windowTitle,
        windowOwner: event.windowOwner,
        screenshotBase64: buf.toString('base64'),
        capturedAt: event.capturedAt,
      };

      const metadata = {
        triggerReason: event.triggerReason,
        appCategory: event.appCategory,
        durationSeconds: event.durationSeconds,
        idleSeconds: event.idleSeconds,
        documentName: event.documentName,
        browserUrl: event.browserUrl,
        previousWindow: event.previousWindow,
        sessionContext: event.sessionContext,
        captureSequence: event.captureSequence,
        windowTitle: event.windowTitle,
        windowOwner: event.windowOwner,
      };

      store.insert({
        id: uuid(),
        type: 'screenshot',
        timestamp: event.capturedAt,
        data: JSON.stringify(captureData),
        metadata: JSON.stringify(metadata),
      });

      logger.info({
        trigger: event.triggerReason,
        window: event.windowTitle,
        duration: event.durationSeconds,
        app: event.appCategory,
      }, 'Capture stored');

      // Push to dashboard
      broadcastCapture(metadata);
    },
  });

  // Start dashboard
  const dashboard = await buildDashboard(store);
  await dashboard.listen({ port: config.dashboardPort, host: '0.0.0.0' });
  logger.info({ port: config.dashboardPort }, 'Dashboard running at http://localhost:' + config.dashboardPort);

  // Update dashboard with activity state every second
  setInterval(() => {
    const win = monitor.getCurrentWindow();
    updateDashboardState({
      state: monitor.getState(),
      currentWindow: win ? { title: win.title, owner: win.owner } : null,
    });
  }, 1000);

  // Start capture system
  monitor.start();
  sender.start();

  // Purge sent captures older than 7 days, every 6 hours
  const purgeInterval = setInterval(() => {
    const purged = store.purgeOlderThan(7);
    if (purged > 0) logger.info({ purged }, 'Purged old sent captures');
  }, 6 * 60 * 60 * 1000);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    monitor.stop();
    sender.stop();
    clearInterval(purgeInterval);
    await dashboard.close();
    store.close();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info(`Desktop agent running. Dashboard: http://localhost:${config.dashboardPort}`);
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});
```

- [ ] **Step 2: Delete window-tracker.ts**

```bash
cd ~/projects/knowledge-harvester-desktop
rm src/window-tracker.ts
```

- [ ] **Step 3: Run full test suite**

Run: `cd ~/projects/knowledge-harvester-desktop && npx vitest run`
Expected: All tests PASS across all test files

- [ ] **Step 4: Verify it builds**

Run: `cd ~/projects/knowledge-harvester-desktop && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
cd ~/projects/knowledge-harvester-desktop
git add src/main.ts src/config.ts
git rm src/window-tracker.ts
git commit -m "feat: wire ActivityMonitor + dashboard, remove WindowTracker"
```

---

### Task 9: Smoke test the agent locally

- [ ] **Step 1: Start the agent**

Run: `cd ~/projects/knowledge-harvester-desktop && npx tsx src/main.ts`
Expected: Logs showing "Activity monitor started", "Dashboard running at http://localhost:3333"

- [ ] **Step 2: Open dashboard in browser**

Open: `http://localhost:3333`
Expected: Dashboard loads showing activity state, current window, empty capture feed

- [ ] **Step 3: Switch between windows and verify captures appear**

Switch between a few apps (browser, editor, terminal). Watch the dashboard feed.
Expected: Captures appear with correct triggerReason, appCategory, documentName, durationSeconds

- [ ] **Step 4: Go idle for 5+ minutes and verify no captures during idle**

Leave the machine idle. Check dashboard.
Expected: State shows "idle", no new captures appear

- [ ] **Step 5: Return from idle and verify idle_to_active capture**

Move the mouse/type. Check dashboard.
Expected: New capture with triggerReason "idle_to_active"

- [ ] **Step 6: Stop agent and commit any fixes**

Ctrl+C to stop. Fix any issues found during smoke test, run tests, commit.
