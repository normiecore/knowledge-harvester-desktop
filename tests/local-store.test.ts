import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalStore } from '../src/local-store.js';
import { existsSync, unlinkSync } from 'node:fs';

const TEST_DB = 'test-captures.db';

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = TEST_DB + suffix;
    if (existsSync(path)) unlinkSync(path);
  }
}

describe('LocalStore', () => {
  let store: LocalStore;

  beforeEach(() => {
    cleanup();
    store = new LocalStore(TEST_DB);
  });

  afterEach(() => {
    store.close();
    cleanup();
  });

  it('inserts and retrieves unsent captures', () => {
    store.insert({ id: 'cap-1', type: 'window', timestamp: '2026-03-27T10:00:00Z', data: '{"title":"test"}' });
    store.insert({ id: 'cap-2', type: 'screenshot', timestamp: '2026-03-27T10:00:10Z', data: 'base64data' });

    const unsent = store.getUnsent();
    expect(unsent).toHaveLength(2);
    expect(unsent[0].id).toBe('cap-1');
    expect(unsent[1].id).toBe('cap-2');
    expect(unsent[0].sent).toBe(0);
  });

  it('marks captures as sent', () => {
    store.insert({ id: 'cap-1', type: 'window', timestamp: '2026-03-27T10:00:00Z', data: 'test' });
    store.markSent('cap-1');

    const unsent = store.getUnsent();
    expect(unsent).toHaveLength(0);
  });

  it('respects limit on getUnsent', () => {
    for (let i = 0; i < 5; i++) {
      store.insert({ id: `cap-${i}`, type: 'window', timestamp: `2026-03-27T10:0${i}:00Z`, data: 'test' });
    }

    const unsent = store.getUnsent(3);
    expect(unsent).toHaveLength(3);
  });

  it('deduplicates by ID', () => {
    store.insert({ id: 'cap-1', type: 'window', timestamp: '2026-03-27T10:00:00Z', data: 'first' });
    store.insert({ id: 'cap-1', type: 'window', timestamp: '2026-03-27T10:00:00Z', data: 'second' });

    const unsent = store.getUnsent();
    expect(unsent).toHaveLength(1);
    expect(unsent[0].data).toBe('first'); // OR IGNORE keeps first
  });
});
