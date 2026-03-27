# Knowledge Harvester Desktop Agent

Lightweight desktop capture agent that monitors active windows and takes periodic screenshots, then ships captures to the GB10 pipeline for knowledge extraction.

## How It Works

```
┌─────────────────────────────┐
│  WindowTracker (1s poll)    │──┐
│  ScreenshotCapture (10s)    │──┤
└─────────────────────────────┘  │
                                 ▼
                          ┌──────────┐
                          │ LocalStore│  SQLite buffer
                          │ (captures │  (offline-safe)
                          │   .db)    │
                          └─────┬────┘
                                │ Sender drains every 5s
                                ▼
                     POST /api/captures
                     ─────────────────
                     GB10 Pipeline (RunPod)
```

- **Window tracking**: Polls active window title/owner every 1s, emits on change
- **Screenshots**: Captures JPEG every 10s, stores as base64
- **Local buffering**: SQLite stores all captures locally — if pipeline is unreachable, captures queue up and drain when it comes back
- **Sender**: Drains local store to pipeline via HTTP POST every 5s
- **Cleanup**: Purges sent captures older than 7 days every 6 hours

## Quick Start

```bash
npm install
cp .env.example .env
# Edit .env with your pipeline URL and user details

# Run in dev mode
npm run dev

# Or build and run
npm run build
npm start
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PIPELINE_URL` | GB10 pipeline base URL | `http://localhost:3001` |
| `USER_ID` | Your user ID (matches Graph API user ID) | `user-1` |
| `USER_EMAIL` | Your email address | `user@company.com` |
| `SCREENSHOT_INTERVAL_MS` | Screenshot capture interval | `10000` (10s) |
| `WINDOW_POLL_INTERVAL_MS` | Window title poll interval | `1000` (1s) |
| `LOG_LEVEL` | Pino log level | `info` |

## Requirements

- Node.js 20+
- Windows (screenshot-desktop and active-win work on macOS/Linux too)
- GB10 pipeline running with `/api/captures` endpoint

## Testing

```bash
npm test
```

## Architecture Notes

This is the **prototype** desktop agent using Node.js. The production version will be a Tauri app (Rust backend + web frontend) with:
- Lower resource usage (~2.3% CPU, ~80 MB RAM)
- Keystroke counting (engagement metrics)
- Native system tray with engram card viewer
- Perceptual hash dedup before sending
