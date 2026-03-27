import activeWin from 'active-win';
import { logger } from './logger.js';

export interface WindowInfo {
  title: string;
  owner: string;
  url?: string;
  timestamp: string;
}

/**
 * Polls the active window every `intervalMs` and calls `onWindowChange`
 * whenever the active window title changes.
 */
export class WindowTracker {
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastTitle = '';

  constructor(
    private intervalMs: number,
    private onWindowChange: (info: WindowInfo) => void,
  ) {}

  start(): void {
    logger.info({ intervalMs: this.intervalMs }, 'Window tracker started');
    this.interval = setInterval(() => this.poll(), this.intervalMs);
    this.poll(); // immediate first poll
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    logger.info('Window tracker stopped');
  }

  private async poll(): Promise<void> {
    try {
      const win = await activeWin();
      if (!win) return;

      const title = win.title ?? '';
      const owner = win.owner?.name ?? '';

      // Only emit on change
      if (title !== this.lastTitle) {
        this.lastTitle = title;
        this.onWindowChange({
          title,
          owner,
          url: (win as any).url, // some platforms provide URL
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      logger.error({ err }, 'Window poll failed');
    }
  }
}
