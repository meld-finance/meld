// Renders every Meld icon PNG from site/logo.svg with headless Chrome.
// Usage: node scripts/make-icons.mjs  (CHROME=/path/to/chrome to override)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const logo = readFileSync(join(root, 'site/logo.svg'), 'utf8');
const tile = 'background:linear-gradient(160deg,#ffffff,#eaf1fb)';

// The tray icon is a macOS template image: black outlines, the system tints it.
const outline = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#000" stroke-width="7">
  ${[[50, 42], [38, 58], [62, 58]].map(([x, y]) => `<rect x="-23" y="-23" width="46" height="46" rx="14" transform="translate(${x} ${y}) rotate(45)"/>`).join('')}
</svg>`;

// kind: 'mac' = macOS icon grid (824px rounded square inside 1024), 'full' = full-bleed square, 'mark' = transparent.
const icons = [
  ['apps/desktop/build/icon.png', 1024, 'mac'],
  ['apps/mobile/public/icon-512.png', 512, 'full'],
  ['apps/mobile/public/icon-192.png', 192, 'full'],
  ['apps/mobile/public/apple-touch-icon.png', 180, 'full'],
  ['site/apple-touch-icon.png', 180, 'full'],
  ['site/icon.png', 256, 'mark'],
  ['site/favicon.png', 48, 'mark'],
  ['apps/mobile/assets/images/favicon.png', 48, 'mark'],
  ['apps/desktop/build/trayTemplate.png', 18, 'tray'],
  ['apps/desktop/build/trayTemplate@2x.png', 36, 'tray'],
];

function page(size, kind) {
  const box = kind === 'mac' ? `position:absolute;left:${size * 100 / 1024}px;top:${size * 100 / 1024}px;width:${size * 824 / 1024}px;height:${size * 824 / 1024}px;border-radius:${size * 185 / 1024}px;${tile}` : kind === 'full' ? `position:absolute;inset:0;${tile}` : '';
  const mark = kind === 'mac' ? 0.72 : kind === 'full' ? 0.84 : 1;
  const svg = kind === 'tray' ? outline : logo;
  return `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;position:relative;overflow:hidden;background:transparent">
<div style="${box}"></div>
<div style="position:absolute;left:${size * (1 - mark) / 2}px;top:${size * (1 - mark) / 2}px;width:${size * mark}px;height:${size * mark}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>
</body></html>`;
}

const tmp = mkdtempSync(join(tmpdir(), 'meld-icons-'));
try {
  for (const [out, size, kind] of icons) {
    const html = join(tmp, 'icon.html');
    const png = join(tmp, 'icon.png');
    writeFileSync(html, page(size, kind));
    execFileSync(chrome, ['--headless', '--hide-scrollbars', '--force-device-scale-factor=1', '--default-background-color=00000000',
      `--window-size=${size},${size}`, `--screenshot=${png}`, `file://${html}`], { stdio: 'ignore' });
    renameSync(png, join(root, out));
    console.log(`${out} (${size}px)`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
