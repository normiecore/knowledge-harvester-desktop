import { logger } from './logger.js';

export interface RawCapturePayload {
  id: string;
  userId: string;
  userEmail: string;
  sourceType: string;
  sourceApp: string;
  capturedAt: string;
  rawContent: string;
  metadata: Record<string, unknown>;
}

/**
 * Sends captures to the GB10 pipeline's NATS ingestion endpoint.
 * For the prototype, we POST directly to the pipeline's API.
 */
export class PipelineClient {
  constructor(
    private baseUrl: string,
    private authToken?: string,
  ) {}

  async sendCapture(payload: RawCapturePayload): Promise<boolean> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }

      const res = await fetch(`${this.baseUrl}/api/captures`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        logger.warn({ status: res.status, captureId: payload.id }, 'Pipeline rejected capture');
        return false;
      }

      return true;
    } catch (err) {
      logger.error({ err, captureId: payload.id }, 'Failed to send capture to pipeline');
      return false;
    }
  }
}
