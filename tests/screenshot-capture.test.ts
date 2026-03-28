import { describe, it, expect, vi } from 'vitest';

// Mock child_process and fs to avoid actual PowerShell calls in tests
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue(Buffer.from('fake-jpeg-data')),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(true),
  };
});

import { execSync } from 'node:child_process';
import { ScreenshotCapture } from '../src/screenshot-capture.js';

describe('ScreenshotCapture', () => {
  it('captureNow() returns a Buffer', async () => {
    (execSync as any).mockReturnValue('OK');

    const capture = new ScreenshotCapture();
    const result = await capture.captureNow();
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result!.length).toBeGreaterThan(0);
  });

  it('captureNow() returns null on failure', async () => {
    (execSync as any).mockImplementationOnce(() => { throw new Error('powershell failed'); });

    const capture = new ScreenshotCapture();
    const result = await capture.captureNow();
    expect(result).toBeNull();
  });
});
