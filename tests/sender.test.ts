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
});
