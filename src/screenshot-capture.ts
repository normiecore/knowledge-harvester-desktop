import { execSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { logger } from './logger.js';

const PS_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$g.Dispose()
$outPath = $args[0]
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$bmp.Dispose()
Write-Output "OK"
`;

const scriptPath = join(tmpdir(), 'kh-screenshot.ps1');
let scriptWritten = false;

function ensureScript(): void {
  if (!scriptWritten || !existsSync(scriptPath)) {
    writeFileSync(scriptPath, PS_SCRIPT, 'utf-8');
    scriptWritten = true;
  }
}

export class ScreenshotCapture {
  async captureNow(): Promise<Buffer | null> {
    try {
      ensureScript();
      const outPath = join(tmpdir(), `kh-capture-${Date.now()}.jpg`);

      execSync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" "${outPath}"`,
        { timeout: 8000, windowsHide: true },
      );

      const buf = readFileSync(outPath);
      try { unlinkSync(outPath); } catch { /* ignore cleanup failure */ }

      logger.debug({ size: buf.length }, 'Screenshot captured');
      return buf;
    } catch (err) {
      logger.error({ err }, 'Screenshot capture failed');
      return null;
    }
  }
}
