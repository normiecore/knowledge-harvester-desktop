import { logger } from './logger.js';
import type { LocalStore } from './local-store.js';
import type { PipelineClient, RawCapturePayload } from './pipeline-client.js';
import { config } from './config.js';

/** Maximum backoff interval when the pipeline is unreachable (ms). */
const MAX_BACKOFF_MS = 60_000;

export class Sender {
  private interval: ReturnType<typeof setInterval> | null = null;

  /** Timestamp (epoch ms) before which drain attempts are skipped. */
  private backoffUntil = 0;
  /** Current backoff delay that doubles on each consecutive failure. */
  private currentBackoffMs: number;

  constructor(
    private store: LocalStore,
    private client: PipelineClient,
    private drainIntervalMs = 5000,
  ) {
    this.currentBackoffMs = this.drainIntervalMs;
  }

  start(): void {
    logger.info({ drainIntervalMs: this.drainIntervalMs }, 'Sender started');
    this.interval = setInterval(() => this.safeDrain(), this.drainIntervalMs);
    this.safeDrain();
  }

  private safeDrain(): void {
    this.drain().catch((err) => {
      logger.error({ err }, 'Sender drain failed unexpectedly');
    });
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async drain(): Promise<void> {
    if (Date.now() < this.backoffUntil) return;

    const unsent = this.store.getUnsent(10);
    if (unsent.length === 0) return;

    for (const record of unsent) {
      try {
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
          this.resetBackoff();
        } else {
          logger.warn(
            { backoffMs: this.currentBackoffMs },
            'Pipeline unreachable, backing off before next drain',
          );
          this.increaseBackoff();
          break;
        }
      } catch (err) {
        logger.error({ err, recordId: record.id }, 'Failed to process capture for sending');
        this.increaseBackoff();
        break;
      }
    }
  }

  private increaseBackoff(): void {
    this.backoffUntil = Date.now() + this.currentBackoffMs;
    this.currentBackoffMs = Math.min(this.currentBackoffMs * 2, MAX_BACKOFF_MS);
  }

  private resetBackoff(): void {
    this.currentBackoffMs = this.drainIntervalMs;
    this.backoffUntil = 0;
  }
}
