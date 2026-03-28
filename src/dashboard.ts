import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { LocalStore } from './local-store.js';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardHtml = readFileSync(join(__dirname, 'dashboard.html'), 'utf-8');

interface DashboardState {
  state: string;
  currentWindow: { title: string; owner: string } | null;
}

let activityState: DashboardState = { state: 'active', currentWindow: null };
const wsClients = new Set<WebSocket>();

export function updateDashboardState(newState: DashboardState): void {
  activityState = newState;
}

export function broadcastCapture(capture: Record<string, unknown>): void {
  const msg = JSON.stringify({ type: 'capture', data: capture });
  for (const ws of wsClients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

export async function buildDashboard(store: LocalStore): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(websocket);

  app.get('/', async (_req, reply) => {
    reply.type('text/html').send(dashboardHtml);
  });

  app.get('/api/recent', async () => {
    const records = store.getRecent(50);
    return records.map(r => {
      let parsedData: any = {};
      try { parsedData = JSON.parse(r.data); } catch { /* raw string */ }
      const { screenshotBase64, ...dataWithoutScreenshot } = parsedData;
      let parsedMeta: any = {};
      try { if (r.metadata) parsedMeta = JSON.parse(r.metadata); } catch { /* ignore */ }
      return {
        id: r.id,
        type: r.type,
        timestamp: r.timestamp,
        data: dataWithoutScreenshot,
        metadata: parsedMeta,
        sent: r.sent,
        hasScreenshot: !!screenshotBase64,
      };
    });
  });

  app.get('/api/stats', async () => store.getStats());

  app.get('/api/state', async () => activityState);

  app.get<{ Params: { id: string } }>('/api/screenshot/:id', async (req, reply) => {
    const record = store.getById(req.params.id);
    if (!record) { reply.code(404).send('Not found'); return; }
    try {
      const parsed = JSON.parse(record.data);
      if (!parsed.screenshotBase64) { reply.code(404).send('No screenshot'); return; }
      const buf = Buffer.from(parsed.screenshotBase64, 'base64');
      reply.type('image/jpeg').send(buf);
    } catch {
      reply.code(500).send('Parse error');
    }
  });

  app.get('/ws', { websocket: true }, (socket) => {
    wsClients.add(socket);
    socket.on('close', () => wsClients.delete(socket));
  });

  return app;
}
