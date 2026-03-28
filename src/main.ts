import { config } from './config.js';
import { logger } from './logger.js';
import { ActivityMonitor, type CaptureEvent } from './activity-monitor.js';
import { ScreenshotCapture } from './screenshot-capture.js';
import { LocalStore } from './local-store.js';
import { PipelineClient } from './pipeline-client.js';
import { Sender } from './sender.js';
import { buildDashboard, updateDashboardState, broadcastCapture } from './dashboard.js';
import { v4 as uuid } from 'uuid';

async function main(): Promise<void> {
  logger.info({ userId: config.userId, pipelineUrl: config.pipelineUrl }, 'Knowledge Harvester Desktop Agent starting');

  const store = new LocalStore('captures.db');
  const client = new PipelineClient(config.pipelineUrl);
  const sender = new Sender(store, client);
  const screenshotCapture = new ScreenshotCapture();

  const monitor = new ActivityMonitor({
    windowPollMs: config.windowPollIntervalMs,
    idleThresholdMs: config.idleThresholdMs,
    periodicCaptureMs: config.periodicCaptureMs,
    onCapture: async (event: CaptureEvent) => {
      const buf = await screenshotCapture.captureNow();
      if (!buf) return;

      const captureData = {
        windowTitle: event.windowTitle,
        windowOwner: event.windowOwner,
        screenshotBase64: buf.toString('base64'),
        capturedAt: event.capturedAt,
      };

      const metadata = {
        triggerReason: event.triggerReason,
        appCategory: event.appCategory,
        durationSeconds: event.durationSeconds,
        idleSeconds: event.idleSeconds,
        documentName: event.documentName,
        browserUrl: event.browserUrl,
        previousWindow: event.previousWindow,
        sessionContext: event.sessionContext,
        captureSequence: event.captureSequence,
        windowTitle: event.windowTitle,
        windowOwner: event.windowOwner,
      };

      store.insert({
        id: uuid(),
        type: 'screenshot',
        timestamp: event.capturedAt,
        data: JSON.stringify(captureData),
        metadata: JSON.stringify(metadata),
      });

      logger.info({
        trigger: event.triggerReason,
        window: event.windowTitle,
        duration: event.durationSeconds,
        app: event.appCategory,
      }, 'Capture stored');

      broadcastCapture(metadata);
    },
  });

  // Start dashboard
  const dashboard = await buildDashboard(store);
  await dashboard.listen({ port: config.dashboardPort, host: '0.0.0.0' });
  logger.info({ port: config.dashboardPort }, 'Dashboard running at http://localhost:' + config.dashboardPort);

  // Update dashboard with activity state every second
  const stateInterval = setInterval(() => {
    const win = monitor.getCurrentWindow();
    updateDashboardState({
      state: monitor.getState(),
      currentWindow: win ? { title: win.title, owner: win.owner } : null,
    });
  }, 1000);

  // Start capture system
  monitor.start();
  sender.start();

  // Purge sent captures older than 7 days, every 6 hours
  const purgeInterval = setInterval(() => {
    const purged = store.purgeOlderThan(7);
    if (purged > 0) logger.info({ purged }, 'Purged old sent captures');
  }, 6 * 60 * 60 * 1000);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    monitor.stop();
    sender.stop();
    clearInterval(stateInterval);
    clearInterval(purgeInterval);
    await dashboard.close();
    store.close();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('Desktop agent running. Dashboard: http://localhost:' + config.dashboardPort);
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});
