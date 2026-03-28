import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalStore } from '../src/local-store.js';
import { Sender } from '../src/sender.js';
import { existsSync, unlinkSync } from 'node:fs';

const TEST_DB = 'test-sender.db';

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = TEST_DB + suffix;
    if (existsSync(path)) unlinkSync(path);
  }
}

describe('Sender', () => {
  let store: LocalStore;

  beforeEach(() => {
    cleanup();
    store = new LocalStore(TEST_DB);
  });

  afterEach(() => {
    store.close();
    cleanup();
  });

  it('drains unsent captures with enriched metadata', async () => {
    store.insert({
      id: 'cap-1',
      type: 'screenshot',
      timestamp: '2026-03-28T10:00:00Z',
      data: '{"screenshotBase64":"abc"}',
      metadata: JSON.stringify({ triggerReason: 'window_change', appCategory: 'editor' }),
    });

    const mockClient = { sendCapture: vi.fn().mockResolvedValue(true) };
    const sender = new Sender(store, mockClient as any, 100000);
    await (sender as any).drain();

    expect(mockClient.sendCapture).toHaveBeenCalledTimes(1);
    const payload = mockClient.sendCapture.mock.calls[0][0];
    expect(payload.metadata.triggerReason).toBe('window_change');
    expect(payload.metadata.appCategory).toBe('editor');
    expect(payload.sourceType).toBe('desktop_screenshot');
    expect(store.getUnsent()).toHaveLength(0);
  });

  it('stops draining on pipeline failure', async () => {
    store.insert({ id: 'cap-1', type: 'screenshot', timestamp: '2026-03-28T10:00:00Z', data: 'a' });
    store.insert({ id: 'cap-2', type: 'screenshot', timestamp: '2026-03-28T10:00:01Z', data: 'b' });

    const mockClient = { sendCapture: vi.fn().mockResolvedValue(false) };
    const sender = new Sender(store, mockClient as any, 100000);
    await (sender as any).drain();

    expect(mockClient.sendCapture).toHaveBeenCalledTimes(1);
    expect(store.getUnsent()).toHaveLength(2);
  });

  it('does nothing when store is empty', async () => {
    const mockClient = { sendCapture: vi.fn().mockResolvedValue(true) };
    const sender = new Sender(store, mockClient as any, 100000);
    await (sender as any).drain();
    expect(mockClient.sendCapture).not.toHaveBeenCalled();
  });

  it('start/stop manages interval lifecycle', () => {
    const mockClient = { sendCapture: vi.fn().mockResolvedValue(true) };
    const sender = new Sender(store, mockClient as any, 100000);
    sender.start();
    expect((sender as any).interval).not.toBeNull();
    sender.stop();
    expect((sender as any).interval).toBeNull();
  });

  it('stop is idempotent when called multiple times', () => {
    const mockClient = { sendCapture: vi.fn().mockResolvedValue(true) };
    const sender = new Sender(store, mockClient as any, 100000);
    sender.stop(); // no-op, never started
    expect((sender as any).interval).toBeNull();
    sender.start();
    sender.stop();
    sender.stop(); // second stop should not throw
    expect((sender as any).interval).toBeNull();
  });

  it('safeDrain catches errors from drain without crashing', async () => {
    const mockClient = {
      sendCapture: vi.fn().mockRejectedValue(new Error('network exploded')),
    };
    store.insert({ id: 'cap-1', type: 'screenshot', timestamp: '2026-03-28T10:00:00Z', data: 'a' });
    const sender = new Sender(store, mockClient as any, 100000);
    // safeDrain should not throw even when sendCapture rejects
    await (sender as any).safeDrain();
    // record should remain unsent
    expect(store.getUnsent()).toHaveLength(1);
  });

  it('continues draining remaining records after one succeeds', async () => {
    store.insert({ id: 'cap-1', type: 'screenshot', timestamp: '2026-03-28T10:00:00Z', data: 'a' });
    store.insert({ id: 'cap-2', type: 'screenshot', timestamp: '2026-03-28T10:00:01Z', data: 'b' });
    store.insert({ id: 'cap-3', type: 'screenshot', timestamp: '2026-03-28T10:00:02Z', data: 'c' });

    const mockClient = {
      sendCapture: vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    };
    const sender = new Sender(store, mockClient as any, 100000);
    await (sender as any).drain();

    expect(mockClient.sendCapture).toHaveBeenCalledTimes(3);
    expect(store.getUnsent()).toHaveLength(1); // only cap-3 remains unsent
  });

  describe('exponential backoff', () => {
    it('skips drain when within backoff window', async () => {
      store.insert({ id: 'cap-1', type: 'screenshot', timestamp: '2026-03-28T10:00:00Z', data: 'a' });

      const mockClient = { sendCapture: vi.fn().mockResolvedValue(false) };
      const sender = new Sender(store, mockClient as any, 5000);

      // First drain fails, which sets backoffUntil into the future
      await (sender as any).drain();
      expect(mockClient.sendCapture).toHaveBeenCalledTimes(1);

      // Second drain should be skipped because we are within the backoff window
      await (sender as any).drain();
      expect(mockClient.sendCapture).toHaveBeenCalledTimes(1);
    });

    it('increases backoff on consecutive failures', async () => {
      store.insert({ id: 'cap-1', type: 'screenshot', timestamp: '2026-03-28T10:00:00Z', data: 'a' });

      const mockClient = { sendCapture: vi.fn().mockResolvedValue(false) };
      const baseInterval = 5000;
      const sender = new Sender(store, mockClient as any, baseInterval);

      // First failure: currentBackoffMs was 5000, so backoffUntil = now + 5000,
      // then currentBackoffMs doubles to 10000
      await (sender as any).drain();
      expect((sender as any).currentBackoffMs).toBe(10000);

      // Simulate time passing beyond the backoff window
      (sender as any).backoffUntil = 0;

      // Second failure: currentBackoffMs was 10000, doubles to 20000
      await (sender as any).drain();
      expect((sender as any).currentBackoffMs).toBe(20000);

      (sender as any).backoffUntil = 0;

      // Third failure: 20000 -> 40000
      await (sender as any).drain();
      expect((sender as any).currentBackoffMs).toBe(40000);
    });

    it('caps backoff at 60 seconds', async () => {
      store.insert({ id: 'cap-1', type: 'screenshot', timestamp: '2026-03-28T10:00:00Z', data: 'a' });

      const mockClient = { sendCapture: vi.fn().mockResolvedValue(false) };
      const sender = new Sender(store, mockClient as any, 5000);

      // Drive the backoff past the cap: 5s -> 10s -> 20s -> 40s -> 60s (capped) -> 60s
      for (let i = 0; i < 6; i++) {
        (sender as any).backoffUntil = 0;
        await (sender as any).drain();
      }

      expect((sender as any).currentBackoffMs).toBe(60000);
    });

    it('resets backoff on successful send', async () => {
      store.insert({ id: 'cap-1', type: 'screenshot', timestamp: '2026-03-28T10:00:00Z', data: 'a' });
      store.insert({ id: 'cap-2', type: 'screenshot', timestamp: '2026-03-28T10:00:01Z', data: 'b' });

      const mockClient = { sendCapture: vi.fn().mockResolvedValue(false) };
      const baseInterval = 5000;
      const sender = new Sender(store, mockClient as any, baseInterval);

      // Fail a few times to build up backoff
      await (sender as any).drain();
      (sender as any).backoffUntil = 0;
      await (sender as any).drain();
      expect((sender as any).currentBackoffMs).toBe(20000);

      // Now succeed
      mockClient.sendCapture.mockResolvedValue(true);
      (sender as any).backoffUntil = 0;
      await (sender as any).drain();

      expect((sender as any).currentBackoffMs).toBe(baseInterval);
      expect((sender as any).backoffUntil).toBe(0);
    });

    it('applies backoff on thrown errors too', async () => {
      store.insert({ id: 'cap-1', type: 'screenshot', timestamp: '2026-03-28T10:00:00Z', data: 'a' });

      const mockClient = {
        sendCapture: vi.fn().mockRejectedValue(new Error('network exploded')),
      };
      const sender = new Sender(store, mockClient as any, 5000);

      await (sender as any).drain();

      // Backoff should have been applied even though an exception was thrown
      expect((sender as any).currentBackoffMs).toBe(10000);
      expect((sender as any).backoffUntil).toBeGreaterThan(Date.now() - 1000);
    });
  });
});
