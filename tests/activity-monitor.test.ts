import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('active-win', () => ({
  default: vi.fn().mockResolvedValue({
    title: 'main.ts - VS Code',
    owner: { name: 'Code' },
    url: undefined,
  }),
}));

// Mock the idle-time module so we don't need PowerShell in tests
vi.mock('../src/idle-time.js', () => ({
  getIdleTimeSeconds: vi.fn().mockReturnValue(0),
}));

import activeWin from 'active-win';
import { ActivityMonitor, type CaptureEvent, classifyApp, extractDocumentName } from '../src/activity-monitor.js';

describe('ActivityMonitor', () => {
  let captures: CaptureEvent[];
  let mockIdleTime: number;
  let monitor: ActivityMonitor;

  beforeEach(() => {
    captures = [];
    mockIdleTime = 0;
    vi.clearAllMocks();

    (activeWin as any).mockResolvedValue({
      title: 'main.ts - VS Code',
      owner: { name: 'Code' },
      url: undefined,
    });

    monitor = new ActivityMonitor({
      windowPollMs: 100,
      idleThresholdMs: 5000,
      periodicCaptureMs: 60000,
      onCapture: (event) => captures.push(event),
      getIdleTime: () => mockIdleTime,
    });
  });

  describe('state machine', () => {
    it('starts in active state', () => {
      expect(monitor.getState()).toBe('active');
    });

    it('transitions to idle when idle time exceeds threshold', async () => {
      mockIdleTime = 6; // 6 seconds > 5s threshold
      await monitor.tick();
      expect(monitor.getState()).toBe('idle');
    });

    it('transitions back to active from idle', async () => {
      mockIdleTime = 6;
      await monitor.tick();
      expect(monitor.getState()).toBe('idle');

      mockIdleTime = 0;
      await monitor.tick();
      expect(monitor.getState()).toBe('active');
    });
  });

  describe('capture triggers', () => {
    it('triggers capture on window change', async () => {
      await monitor.tick(); // baseline

      (activeWin as any).mockResolvedValue({
        title: 'Chrome - Google',
        owner: { name: 'chrome' },
        url: 'https://google.com',
      });
      await monitor.tick();
      expect(captures).toHaveLength(1);
      expect(captures[0].triggerReason).toBe('window_change');
      // previousWindow is null on the first change since there was no window before the baseline
      expect(captures[0].previousWindow).toBeNull();
      // But the captured window (the one being left) IS the baseline window
      expect(captures[0].windowTitle).toBe('main.ts - VS Code');
      expect(captures[0].windowOwner).toBe('Code');
    });

    it('triggers capture on idle-to-active transition', async () => {
      await monitor.tick(); // baseline

      mockIdleTime = 6;
      await monitor.tick(); // go idle

      mockIdleTime = 0;
      await monitor.tick(); // come back
      const idleCapture = captures.find(c => c.triggerReason === 'idle_to_active');
      expect(idleCapture).toBeDefined();
    });

    it('does NOT trigger capture while idle', async () => {
      await monitor.tick(); // baseline
      captures.length = 0;

      mockIdleTime = 6;
      await monitor.tick();
      await monitor.tick();
      await monitor.tick();

      expect(captures).toHaveLength(0);
    });
  });

  describe('metadata enrichment', () => {
    it('extracts document name from window title', async () => {
      (activeWin as any).mockResolvedValue({
        title: 'ROV-123-inspection.xlsx - Excel',
        owner: { name: 'EXCEL' },
      });
      await monitor.tick(); // baseline

      (activeWin as any).mockResolvedValue({
        title: 'Chrome - Google',
        owner: { name: 'chrome' },
      });
      await monitor.tick(); // trigger
      expect(captures[0].documentName).toBe('ROV-123-inspection.xlsx');
    });

    it('classifies app categories', async () => {
      await monitor.tick(); // baseline with Code

      (activeWin as any).mockResolvedValue({
        title: 'Google - Chrome',
        owner: { name: 'chrome' },
      });
      await monitor.tick();
      expect(captures[0].appCategory).toBe('editor');
    });

    it('tracks duration in previous window', async () => {
      const startTime = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(startTime);
      await monitor.tick(); // baseline

      vi.spyOn(Date, 'now').mockReturnValue(startTime + 5000);
      (activeWin as any).mockResolvedValue({
        title: 'Other',
        owner: { name: 'other' },
      });
      await monitor.tick();
      expect(captures[0].durationSeconds).toBeGreaterThanOrEqual(4);
      expect(captures[0].durationSeconds).toBeLessThanOrEqual(6);

      vi.restoreAllMocks();
    });

    it('builds session context from recent windows', async () => {
      const windows = [
        { title: 'File A - Code', owner: { name: 'Code' } },
        { title: 'Chrome - Docs', owner: { name: 'chrome' } },
        { title: 'Teams - Chat', owner: { name: 'Teams' } },
        { title: 'File B - Code', owner: { name: 'Code' } },
      ];

      for (const win of windows) {
        (activeWin as any).mockResolvedValue(win);
        await monitor.tick();
      }

      const lastCapture = captures[captures.length - 1];
      expect(lastCapture.sessionContext.length).toBeGreaterThanOrEqual(2);
      expect(lastCapture.sessionContext.length).toBeLessThanOrEqual(5);
    });

    it('increments captureSequence', async () => {
      await monitor.tick();
      (activeWin as any).mockResolvedValue({ title: 'B', owner: { name: 'b' } });
      await monitor.tick();
      (activeWin as any).mockResolvedValue({ title: 'C', owner: { name: 'c' } });
      await monitor.tick();

      expect(captures[0].captureSequence).toBe(1);
      expect(captures[1].captureSequence).toBe(2);
    });
  });
});

describe('classifyApp', () => {
  it('classifies known apps', () => {
    expect(classifyApp('Code')).toBe('editor');
    expect(classifyApp('chrome')).toBe('browser');
    expect(classifyApp('Teams')).toBe('communication');
    expect(classifyApp('EXCEL')).toBe('document');
    expect(classifyApp('WindowsTerminal')).toBe('terminal');
    expect(classifyApp('RandomApp')).toBe('other');
  });
});

describe('extractDocumentName', () => {
  it('extracts filenames from window titles', () => {
    expect(extractDocumentName('ROV-123.xlsx - Excel')).toBe('ROV-123.xlsx');
    expect(extractDocumentName('main.ts - VS Code')).toBe('main.ts');
    expect(extractDocumentName('Google Chrome')).toBeUndefined();
  });
});
