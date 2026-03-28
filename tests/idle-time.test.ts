import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock child_process and fs
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
}));

import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

describe('idle-time', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(execSync).mockReset();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(writeFileSync).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns idle time in seconds from PowerShell output', async () => {
    vi.mocked(execSync).mockReturnValue('42\r\n');

    const { getIdleTimeSeconds } = await import('../src/idle-time.js');
    const result = getIdleTimeSeconds();

    expect(result).toBe(42);
  });

  it('writes the PowerShell script to temp dir on first call', async () => {
    vi.mocked(execSync).mockReturnValue('10\n');
    vi.mocked(existsSync).mockReturnValue(false);

    const { getIdleTimeSeconds } = await import('../src/idle-time.js');
    getIdleTimeSeconds();

    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const [path, content] = vi.mocked(writeFileSync).mock.calls[0] as [string, string, string];
    expect(path).toContain('kh-idle-time.ps1');
    expect(content).toContain('GetLastInputInfo');
  });

  it('returns cached value when called within poll interval', async () => {
    vi.mocked(execSync).mockReturnValue('15\n');

    const { getIdleTimeSeconds } = await import('../src/idle-time.js');

    const first = getIdleTimeSeconds();
    expect(execSync).toHaveBeenCalledTimes(1);

    // Second call within POLL_INTERVAL_MS (2000ms) should return cached value
    const second = getIdleTimeSeconds();
    expect(execSync).toHaveBeenCalledTimes(1); // not called again
    expect(second).toBe(first);
  });

  it('returns 0 when execSync throws an error', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('PowerShell not found');
    });

    const { getIdleTimeSeconds } = await import('../src/idle-time.js');
    const result = getIdleTimeSeconds();

    // The initial cachedIdleTime is 0, so after the error it remains 0
    expect(result).toBe(0);
  });

  it('returns 0 when PowerShell outputs non-numeric text', async () => {
    vi.mocked(execSync).mockReturnValue('some error text\n');

    const { getIdleTimeSeconds } = await import('../src/idle-time.js');
    const result = getIdleTimeSeconds();

    // parseInt('some error text') returns NaN, || 0 gives 0
    expect(result).toBe(0);
  });

  it('calls execSync with correct powershell arguments', async () => {
    vi.mocked(execSync).mockReturnValue('5\n');

    const { getIdleTimeSeconds } = await import('../src/idle-time.js');
    getIdleTimeSeconds();

    const call = vi.mocked(execSync).mock.calls[0];
    const command = call[0] as string;
    expect(command).toContain('powershell');
    expect(command).toContain('-NoProfile');
    expect(command).toContain('-ExecutionPolicy Bypass');
    expect(command).toContain('kh-idle-time.ps1');

    const options = call[1] as Record<string, unknown>;
    expect(options.timeout).toBe(3000);
    expect(options.encoding).toBe('utf-8');
  });
});
