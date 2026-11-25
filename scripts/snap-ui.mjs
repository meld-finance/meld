#!/usr/bin/env node
// Captures 2x Retina desktop (1440x900) and mobile (390x844) PNG screenshots of Meld routes
// via headless Chrome DevTools Protocol, handling APP_PASSPHRASE login automatically when present.
//
// Usage:
//   npm run ui:snap -- / /plan/tax
//   npm run ui:snap -- --url http://localhost:8081 --api http://localhost:4000 --out /tmp/snap /spending
//   npm run ui:snap -- --theme dark http://localhost:8081/accounts
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function printHelp() {
  console.log(`Usage: npm run ui:snap -- [options] [paths_or_urls...]

Options:
  --url <baseUrl>        Web app origin (default: MELD_UI_URL or http://localhost:8081)
  --api <apiUrl>         API origin for passphrase login (default: EXPO_PUBLIC_API_URL or http://localhost:4000)
  --out <dir>            Output directory (default: /tmp/meld-ui-snap)
  --theme <light|dark>   Theme to force in localStorage & media features (default: light)
  --help, -h             Show this help`);
}

function parseArgs(argv) {
  let baseUrl = process.env.MELD_UI_URL || 'http://localhost:8081';
  let apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
  let outDir = '/tmp/meld-ui-snap';
  let theme = 'light';
  const targets = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--url') {
      baseUrl = argv[++i] || '';
    } else if (arg === '--api') {
      apiUrl = argv[++i] || '';
    } else if (arg === '--out') {
      outDir = argv[++i] || '';
    } else if (arg === '--theme') {
      theme = argv[++i] === 'dark' ? 'dark' : 'light';
    } else if (!arg.startsWith('--')) {
      targets.push(arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!baseUrl) throw new Error('Missing value for --url');
  if (!outDir) throw new Error('Missing value for --out');
  if (targets.length === 0) targets.push('/');

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiUrl: apiUrl.replace(/\/+$/, ''),
    outDir: resolve(outDir),
    theme,
    targets,
  };
}

function readEnvVar(name) {
  if (process.env[name]) return process.env[name];
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return null;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`));
    if (m) return m[1].replace(/^['"]|['"]$/g, '');
  }
  return null;
}

async function resolveAuthToken(baseUrl, apiUrl) {
  const passphrase = readEnvVar('APP_PASSPHRASE');
  if (!passphrase) return null;

  const endpoints = [...new Set([`${apiUrl}/auth/login`, `${baseUrl}/api/auth/login`])];
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      if (data?.token) return data.token;
    } catch {
      // Try next candidate login endpoint.
    }
  }
  console.warn('Warning: APP_PASSPHRASE is set, but automatic login did not return a token; continuing without session token.');
  return null;
}

function toTargetUrl(target, baseUrl) {
  if (/^https?:\/\//i.test(target)) return target;
  const path = target.startsWith('/') ? target : `/${target}`;
  return `${baseUrl}${path}`;
}

function slugForUrl(urlStr) {
  const u = new URL(urlStr);
  const raw = `${u.pathname}${u.search}`.replace(/^\/+/, '');
  if (!raw) return 'home';
  return raw.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'home';
}

function findChrome() {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error('Could not find Chrome/Chromium binary. Set CHROME=/path/to/chrome.');
}

function terminateProcess(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolveDone) => {
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      resolveDone();
    }, 3000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolveDone();
    });
    try { proc.kill('SIGTERM'); } catch {
      clearTimeout(timer);
      resolveDone();
    }
  });
}

async function launchCdp(profileDir) {
  const chromePath = findChrome();
  const proc = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  const wsUrl = await new Promise((resolveWs, reject) => {
    let logs = '';
    const timer = setTimeout(() => reject(new Error(`Timed out starting Chrome DevTools:\n${logs}`)), 15000);
    proc.stderr.on('data', (chunk) => {
      logs += chunk.toString();
      const m = logs.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(timer);
        resolveWs(m[1]);
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited with code ${code}:\n${logs}`));
    });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((resolveOpen, reject) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', (e) => reject(new Error(`CDP WebSocket error: ${e.message ?? 'unknown'}`)), { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve: res, reject: rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(`CDP ${msg.error.message}`));
      else res(msg.result);
    }
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { resolve: res, reject: rej });
      ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });

  const close = async () => {
    ws.close();
    await terminateProcess(proc);
  };

  return { send, close };
}

function buildInitScript({ theme, token }) {
  return `(() => {
    try {
      localStorage.setItem('meld.theme', ${JSON.stringify(theme)});
      ${token ? `localStorage.setItem('meld.session', ${JSON.stringify(token)});` : ''}
    } catch {}
  })();`;
}

async function waitForPageReady(cdp, sessionId, extraMs = 600) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const { result } = await cdp.send(
      'Runtime.evaluate',
      {
        expression: `(() => {
          if (document.readyState !== 'complete') return false;
          const text = document.body?.innerText || '';
          if (!text.trim() || text.includes('Loading…') || text.includes('Checking your accounts') || text.includes('Checking Tailscale…')) return false;
          return true;
        })()`,
        returnByValue: true,
      },
      sessionId,
    );
    if (result.value) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  await cdp.send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const style = document.createElement('style');
        style.textContent = '::-webkit-scrollbar{display:none!important}*{scrollbar-width:none!important}';
        document.head.appendChild(style);
      })()`,
    },
    sessionId,
  );
  await new Promise((r) => setTimeout(r, extraMs));
}

async function captureViewport(cdp, { url, width, height, mobile, theme, token }) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile }, sessionId);
    await cdp.send(
      'Emulation.setEmulatedMedia',
      {
        media: 'screen',
        features: [
          { name: 'prefers-color-scheme', value: theme },
          { name: 'prefers-reduced-motion', value: 'reduce' },
        ],
      },
      sessionId,
    );
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: buildInitScript({ theme, token }) }, sessionId);
    await cdp.send('Page.navigate', { url }, sessionId);
    await waitForPageReady(cdp, sessionId);

    const { data } = await cdp.send(
      'Page.captureScreenshot',
      { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } },
      sessionId,
    );
    return Buffer.from(data, 'base64');
  } finally {
    await cdp.send('Target.disposeBrowserContext', { browserContextId });
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(opts.outDir, { recursive: true });
  const profileDir = mkdtempSync(join(tmpdir(), 'meld-ui-snap-'));
  const token = await resolveAuthToken(opts.baseUrl, opts.apiUrl);
  const cdp = await launchCdp(profileDir);

  try {
    const viewports = [
      { label: 'desktop-1440', width: 1440, height: 900, mobile: false },
      { label: 'mobile-390', width: 390, height: 844, mobile: true },
    ];
    for (const target of opts.targets) {
      const url = toTargetUrl(target, opts.baseUrl);
      const slug = slugForUrl(url);
      for (const vp of viewports) {
        const buf = await captureViewport(cdp, { ...vp, url, theme: opts.theme, token });
        const filePath = join(opts.outDir, `${slug}-${vp.label}.png`);
        writeFileSync(filePath, buf);
        console.log(filePath);
      }
    }
  } finally {
    await cdp.close();
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

await main();
