import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalStore } from '../src/local-store.js';
import { buildDashboard } from '../src/dashboard.js';
import { existsSync, unlinkSync } from 'node:fs';

const TEST_DB = 'test-dashboard.db';

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = TEST_DB + suffix;
    if (existsSync(path)) unlinkSync(path);
  }
}

describe('Dashboard', () => {
  let store: LocalStore;
  let app: Awaited<ReturnType<typeof buildDashboard>>;

  beforeEach(async () => {
    cleanup();
    store = new LocalStore(TEST_DB);
    app = await buildDashboard(store);
  });

  afterEach(async () => {
    await app.close();
    store.close();
    cleanup();
  });

  it('GET / returns HTML', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Knowledge Harvester');
  });

  it('GET /api/recent returns recent captures without screenshot base64', async () => {
    store.insert({
      id: 'cap-1',
      type: 'screenshot',
      timestamp: '2026-03-28T10:00:00Z',
      data: JSON.stringify({ screenshotBase64: 'abc123', windowTitle: 'Test' }),
      metadata: JSON.stringify({ triggerReason: 'window_change' }),
    });

    const res = await app.inject({ method: 'GET', url: '/api/recent' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('cap-1');
    expect(body[0].hasScreenshot).toBe(true);
    expect(body[0].data.screenshotBase64).toBeUndefined(); // stripped
    expect(body[0].metadata.triggerReason).toBe('window_change');
  });

  it('GET /api/stats returns capture statistics', async () => {
    store.insert({ id: 'cap-1', type: 'screenshot', timestamp: '2026-03-28T10:00:00Z', data: 'a' });
    store.insert({ id: 'cap-2', type: 'screenshot', timestamp: '2026-03-28T10:01:00Z', data: 'b' });
    store.markSent('cap-1');

    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(2);
    expect(body.unsent).toBe(1);
    expect(body.sent).toBe(1);
  });

  it('GET /api/state returns activity state', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/state' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('state');
    expect(body).toHaveProperty('currentWindow');
  });

  it('GET /api/screenshot/:id returns 404 for missing capture', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/screenshot/nonexistent' });
    expect(res.statusCode).toBe(404);
  });
});
