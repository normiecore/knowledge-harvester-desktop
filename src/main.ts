import { config } from './config.js';
import { logger } from './logger.js';
import { WindowTracker } from './window-tracker.js';
import { ScreenshotCapture } from './screenshot-capture.js';
import { LocalStore } from './local-store.js';
import { PipelineClient } from './pipeline-client.js';
import { Sender } from './sender.js';
import { v4 as uuid } from 'uuid';

async function main(): Promise<void> {
  logger.info({ userId: config.userId, pipelineUrl: config.pipelineUrl }, 'Knowledge Harvester Desktop Agent starting');

  const store = new LocalStore('captures.db');
  const client = new PipelineClient(config.pipelineUrl);
  const sender = new Sender(store, client);

  // Window tracker — stores window changes locally
  const windowTracker = new WindowTracker(config.windowPollIntervalMs, (info) => {
    logger.debug({ title: info.title, owner: info.owner }, 'Window change');
    store.insert({
      id: uuid(),
      type: 'window',
      timestamp: info.timestamp,
      data: JSON.stringify(info),
    });
  });

  // Screenshot capture — stores screenshots as base64 locally
  const screenshotCapture = new ScreenshotCapture(config.screenshotIntervalMs, (buf, ts) => {
    logger.debug({ size: buf.length }, 'Screenshot captured');
    store.insert({
      id: uuid(),
      type: 'screenshot',
      timestamp: ts,
      data: buf.toString('base64'),
    });
  });

  // Start all components
  windowTracker.start();
  screenshotCapture.start();
  sender.start();

  // Purge sent captures older than 7 days, every 6 hours
  const purgeInterval = setInterval(() => {
    const purged = store.purgeOlderThan(7);
    if (purged > 0) logger.info({ purged }, 'Purged old sent captures');
  }, 6 * 60 * 60 * 1000);

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    windowTracker.stop();
    screenshotCapture.stop();
    sender.stop();
    clearInterval(purgeInterval);
    store.close();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('Desktop agent running. Press Ctrl+C to stop.');
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});
