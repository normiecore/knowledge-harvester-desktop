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
