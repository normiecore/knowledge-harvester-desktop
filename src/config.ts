import 'dotenv/config';

export const config = {
  pipelineUrl: process.env.PIPELINE_URL ?? 'http://localhost:3001',
  userId: process.env.USER_ID ?? 'user-1',
  userEmail: process.env.USER_EMAIL ?? 'user@company.com',
  windowPollIntervalMs: parseInt(process.env.WINDOW_POLL_INTERVAL_MS ?? '1000', 10),
  idleThresholdMs: parseInt(process.env.IDLE_THRESHOLD_MS ?? '300000', 10),
  periodicCaptureMs: parseInt(process.env.PERIODIC_CAPTURE_MS ?? '60000', 10),
  dashboardPort: parseInt(process.env.DASHBOARD_PORT ?? '3333', 10),
  dashboardHost: process.env.DASHBOARD_HOST ?? '127.0.0.1',
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
