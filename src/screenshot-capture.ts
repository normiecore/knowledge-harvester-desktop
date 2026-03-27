import screenshot from 'screenshot-desktop';
import { logger } from './logger.js';

/**
 * Captures a screenshot every `intervalMs` and calls `onCapture`
 * with the JPEG buffer.
 */
export class ScreenshotCapture {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private intervalMs: number,
    private onCapture: (imageBuffer: Buffer, timestamp: string) => void,
  ) {}

  start(): void {
    logger.info({ intervalMs: this.intervalMs }, 'Screenshot capture started');
    this.interval = setInterval(() => this.capture(), this.intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    logger.info('Screenshot capture stopped');
  }

  private async capture(): Promise<void> {
    try {
      const img = await screenshot({ format: 'jpg' });
      const buf = Buffer.isBuffer(img) ? img : Buffer.from(img);
      this.onCapture(buf, new Date().toISOString());
    } catch (err) {
      logger.error({ err }, 'Screenshot capture failed');
    }
  }
}
