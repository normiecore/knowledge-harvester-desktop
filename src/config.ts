import 'dotenv/config';

export const config = {
  pipelineUrl: process.env.PIPELINE_URL ?? 'http://localhost:3001',
  userId: process.env.USER_ID ?? 'user-1',
  userEmail: process.env.USER_EMAIL ?? 'user@company.com',
  screenshotIntervalMs: parseInt(process.env.SCREENSHOT_INTERVAL_MS ?? '10000', 10),
  windowPollIntervalMs: parseInt(process.env.WINDOW_POLL_INTERVAL_MS ?? '1000', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
