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

  it('drains unsent captures to the pipeline client', async () => {
    store.insert({ id: 'cap-1', type: 'window', timestamp: '2026-03-27T10:00:00Z', data: '{"title":"VS Code"}' });
    store.insert({ id: 'cap-2', type: 'window', timestamp: '2026-03-27T10:00:01Z', data: '{"title":"Chrome"}' });

    const mockClient = {
      sendCapture: vi.fn().mockResolvedValue(true),
    };

    const sender = new Sender(store, mockClient as any, 100000); // long interval, we'll call drain manually

    // Access private drain method via prototype
    await (sender as any).drain();

    expect(mockClient.sendCapture).toHaveBeenCalledTimes(2);
    expect(store.getUnsent()).toHaveLength(0); // both marked sent
  });

  it('stops draining on pipeline failure', async () => {
    store.insert({ id: 'cap-1', type: 'window', timestamp: '2026-03-27T10:00:00Z', data: '{"title":"VS Code"}' });
    store.insert({ id: 'cap-2', type: 'window', timestamp: '2026-03-27T10:00:01Z', data: '{"title":"Chrome"}' });

    const mockClient = {
      sendCapture: vi.fn().mockResolvedValue(false), // pipeline down
    };

    const sender = new Sender(store, mockClient as any, 100000);
    await (sender as any).drain();

    expect(mockClient.sendCapture).toHaveBeenCalledTimes(1); // stopped after first failure
    expect(store.getUnsent()).toHaveLength(2); // neither marked sent (first failed, second not attempted)
  });

  it('does nothing when store is empty', async () => {
    const mockClient = {
      sendCapture: vi.fn().mockResolvedValue(true),
    };

    const sender = new Sender(store, mockClient as any, 100000);
    await (sender as any).drain();

    expect(mockClient.sendCapture).not.toHaveBeenCalled();
  });
});
