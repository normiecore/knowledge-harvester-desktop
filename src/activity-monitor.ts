import activeWin from 'active-win';
import { getIdleTimeSeconds } from './idle-time.js';
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
  enteredAt: number;
}

export interface ActivityMonitorOptions {
  windowPollMs: number;
  idleThresholdMs: number;
  periodicCaptureMs: number;
  onCapture: (event: CaptureEvent) => void | Promise<void>;
  getIdleTime?: () => number; // injectable for testing
}

const APP_CATEGORIES: Record<string, AppCategory> = {
  code: 'editor', vim: 'editor', neovim: 'editor',
  notepad: 'editor', sublime: 'editor',
  chrome: 'browser', firefox: 'browser', edge: 'browser', msedge: 'browser',
  brave: 'browser', safari: 'browser', opera: 'browser',
  teams: 'communication', slack: 'communication', outlook: 'communication',
  discord: 'communication', zoom: 'communication', skype: 'communication',
  excel: 'document', word: 'document', powerpoint: 'document',
  acrobat: 'document', libreoffice: 'document',
  'windows terminal': 'terminal', cmd: 'terminal',
  powershell: 'terminal', windowsterminal: 'terminal', alacritty: 'terminal',
};

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
  private idleTimeFn: () => number;

  constructor(opts: ActivityMonitorOptions) {
    this.opts = opts;
    this.idleTimeFn = opts.getIdleTime ?? getIdleTimeSeconds;
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
    this.interval = setInterval(() => this.safeTick(), this.opts.windowPollMs);
    this.safeTick();
  }

  private safeTick(): void {
    this.tick().catch((err) => {
      logger.error({ err }, 'Activity monitor tick failed (unhandled)');
    });
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
      const idleSeconds = this.idleTimeFn();
      const wasIdle = this.state === 'idle';
      const isIdle = (idleSeconds * 1000) >= this.opts.idleThresholdMs;
      this.state = isIdle ? 'idle' : 'active';

      if (isIdle) return;

      const win = await activeWin();
      if (!win) return;

      const title = win.title ?? '';
      const owner = win.owner?.name ?? '';
      const url = (win as any).url as string | undefined;
      const now = Date.now();

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

      try {
        await Promise.resolve(this.opts.onCapture(event));
      } catch (cbErr) {
        logger.error({ cbErr }, 'onCapture callback failed');
      }
      this.lastPeriodicCapture = now;

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
