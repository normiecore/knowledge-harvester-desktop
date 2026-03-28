import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger before importing the module
vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { PipelineClient, type RawCapturePayload } from '../src/pipeline-client.js';

function makePayload(overrides: Partial<RawCapturePayload> = {}): RawCapturePayload {
  return {
    id: 'cap-1',
    userId: 'user-1',
    userEmail: 'user@company.com',
    sourceType: 'desktop_screenshot',
    sourceApp: 'Code',
    capturedAt: '2026-03-28T10:00:00Z',
    rawContent: '{"screenshotBase64":"abc"}',
    metadata: { triggerReason: 'window_change' },
    ...overrides,
  };
}

describe('PipelineClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends a capture successfully and returns true', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    const client = new PipelineClient('http://localhost:3001');
    const result = await client.sendCapture(makePayload());

    expect(result).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/captures');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual(makePayload());
  });

  it('returns false when pipeline responds with non-ok status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
    });

    const client = new PipelineClient('http://localhost:3001');
    const result = await client.sendCapture(makePayload());

    expect(result).toBe(false);
  });

  it('returns false when fetch throws a network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const client = new PipelineClient('http://localhost:3001');
    const result = await client.sendCapture(makePayload());

    expect(result).toBe(false);
  });

  it('includes Authorization header when authToken is provided', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    const client = new PipelineClient('http://localhost:3001', 'my-secret-token');
    await client.sendCapture(makePayload());

    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer my-secret-token');
  });

  it('does not include Authorization header when no authToken is given', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    const client = new PipelineClient('http://localhost:3001');
    await client.sendCapture(makePayload());

    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options.headers['Authorization']).toBeUndefined();
  });

  it('uses the configured base URL for the endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const client = new PipelineClient('https://pipeline.example.com:9000');
    await client.sendCapture(makePayload());

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://pipeline.example.com:9000/api/captures');
  });

  it('handles timeout errors gracefully and returns false', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

    const client = new PipelineClient('http://localhost:3001');
    const result = await client.sendCapture(makePayload());

    expect(result).toBe(false);
  });
});
