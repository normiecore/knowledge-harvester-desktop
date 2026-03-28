import { execSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { logger } from './logger.js';

const PS_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class IdleTime {
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
    [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    public static int GetIdleSeconds() {
        LASTINPUTINFO info = new LASTINPUTINFO();
        info.cbSize = (uint)Marshal.SizeOf(info);
        GetLastInputInfo(ref info);
        return (int)((uint)Environment.TickCount - info.dwTime) / 1000;
    }
}
"@
[IdleTime]::GetIdleSeconds()
`;

const scriptPath = join(tmpdir(), 'kh-idle-time.ps1');
let scriptWritten = false;

let cachedIdleTime = 0;
let lastPoll = 0;
const POLL_INTERVAL_MS = 2000;

function ensureScript(): void {
  if (!scriptWritten || !existsSync(scriptPath)) {
    writeFileSync(scriptPath, PS_SCRIPT, 'utf-8');
    scriptWritten = true;
  }
}

export function getIdleTimeSeconds(): number {
  const now = Date.now();
  if (now - lastPoll < POLL_INTERVAL_MS) return cachedIdleTime;

  try {
    ensureScript();
    const result = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
      { timeout: 3000, encoding: 'utf-8', windowsHide: true },
    );
    cachedIdleTime = parseInt(result.trim(), 10) || 0;
    lastPoll = now;
  } catch (err) {
    logger.error({ err }, 'Failed to get idle time');
  }
  return cachedIdleTime;
}
