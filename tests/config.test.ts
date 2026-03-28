import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset module registry so config re-evaluates process.env
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses default values when no env vars are set', async () => {
    // Clear all relevant env vars
    delete process.env.PIPELINE_URL;
    delete process.env.USER_ID;
    delete process.env.USER_EMAIL;
    delete process.env.WINDOW_POLL_INTERVAL_MS;
    delete process.env.IDLE_THRESHOLD_MS;
    delete process.env.PERIODIC_CAPTURE_MS;
    delete process.env.DASHBOARD_PORT;
    delete process.env.LOG_LEVEL;

    const { config } = await import('../src/config.js');

    expect(config.pipelineUrl).toBe('http://localhost:3001');
    expect(config.userId).toBe('user-1');
    expect(config.userEmail).toBe('user@company.com');
    expect(config.windowPollIntervalMs).toBe(1000);
    expect(config.idleThresholdMs).toBe(300000);
    expect(config.periodicCaptureMs).toBe(60000);
    expect(config.dashboardPort).toBe(3333);
    expect(config.logLevel).toBe('info');
  });

  it('reads values from environment variables', async () => {
    process.env.PIPELINE_URL = 'http://pipeline:9000';
    process.env.USER_ID = 'test-user-42';
    process.env.USER_EMAIL = 'test@example.org';
    process.env.WINDOW_POLL_INTERVAL_MS = '500';
    process.env.IDLE_THRESHOLD_MS = '120000';
    process.env.PERIODIC_CAPTURE_MS = '30000';
    process.env.DASHBOARD_PORT = '4444';
    process.env.LOG_LEVEL = 'debug';

    const { config } = await import('../src/config.js');

    expect(config.pipelineUrl).toBe('http://pipeline:9000');
    expect(config.userId).toBe('test-user-42');
    expect(config.userEmail).toBe('test@example.org');
    expect(config.windowPollIntervalMs).toBe(500);
    expect(config.idleThresholdMs).toBe(120000);
    expect(config.periodicCaptureMs).toBe(30000);
    expect(config.dashboardPort).toBe(4444);
    expect(config.logLevel).toBe('debug');
  });

  it('parses numeric env vars as integers', async () => {
    process.env.WINDOW_POLL_INTERVAL_MS = '2500';
    process.env.DASHBOARD_PORT = '8080';
    delete process.env.IDLE_THRESHOLD_MS;

    const { config } = await import('../src/config.js');

    expect(typeof config.windowPollIntervalMs).toBe('number');
    expect(config.windowPollIntervalMs).toBe(2500);
    expect(typeof config.dashboardPort).toBe('number');
    expect(config.dashboardPort).toBe(8080);
    // Default should still be a number
    expect(typeof config.idleThresholdMs).toBe('number');
  });

  it('handles NaN from invalid numeric env vars by returning NaN', async () => {
    process.env.DASHBOARD_PORT = 'not-a-number';

    const { config } = await import('../src/config.js');

    // parseInt('not-a-number', 10) returns NaN
    expect(config.dashboardPort).toBeNaN();
  });

  it('preserves partial env overrides with remaining defaults', async () => {
    process.env.USER_ID = 'custom-user';
    delete process.env.PIPELINE_URL;
    delete process.env.DASHBOARD_PORT;

    const { config } = await import('../src/config.js');

    expect(config.userId).toBe('custom-user');
    expect(config.pipelineUrl).toBe('http://localhost:3001');
    expect(config.dashboardPort).toBe(3333);
  });
});
