import screenshot from 'screenshot-desktop';
import { logger } from './logger.js';

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
