import { describe, it, expect, vi } from 'vitest';

vi.mock('screenshot-desktop', () => ({
  default: vi.fn().mockResolvedValue(Buffer.from('fake-jpeg')),
}));

import { ScreenshotCapture } from '../src/screenshot-capture.js';

describe('ScreenshotCapture', () => {
  it('captureNow() returns a Buffer', async () => {
    const capture = new ScreenshotCapture();
    const result = await capture.captureNow();
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result!.length).toBeGreaterThan(0);
  });

  it('captureNow() returns null on failure', async () => {
    const screenshotMod = await import('screenshot-desktop');
    (screenshotMod.default as any).mockRejectedValueOnce(new Error('no display'));

    const capture = new ScreenshotCapture();
    const result = await capture.captureNow();
    expect(result).toBeNull();
  });
});
