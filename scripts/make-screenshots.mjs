// Captures 2x Retina PNG screenshots of Meld (from Plaid's sandbox database) into site/images/,
// keeps width/height attributes in site/index.html in sync, and validates image resolution.
//
// Usage:
//   npm run site:screenshots                 # export web app, launch isolated sandbox API, capture & check
//   node scripts/make-screenshots.mjs --url http://127.0.0.1:4099   # capture against a running sandbox Meld
//   npm run site:check                       # verify site/images/*.png & HTML/README without Chrome
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const siteDir = join(root, 'site');
const imagesDir = join(siteDir, 'images');
const indexHtmlPath = join(siteDir, 'index.html');
const readmePath = join(root, 'README.md');

const MAX_BYTES = 1024 * 1024;
const MIN_WIDTHS = {
  'home.png': 2000,
  'ask.png': 1200,
  'recurring.png': 1800,
  'spending.png': 1800,
  'accounts.png': 1800,
  'retirement.png': 1800,
  'tax.png': 1800,
};

const args = process.argv.slice(2);
if (args.includes('--check')) {
  checkScreenshots();
  process.exit(0);
}

const urlFlagIdx = args.indexOf('--url');
const explicitUrl = urlFlagIdx !== -1 ? args[urlFlagIdx + 1] : null;
if (urlFlagIdx !== -1 && !explicitUrl) {
  console.error('Missing value for --url');
  process.exit(1);
}

await main();

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'meld-screenshots-'));
  let apiProc = null;

  try {
    let baseUrl = explicitUrl;
    if (!baseUrl) {
      const dbUrl = resolveSandboxDatabaseUrl();
      assertSandboxDatabaseUrl(dbUrl);

      const webDir = join(tmp, 'web');
      const docsDir = join(tmp, 'docs');
      const configFile = join(tmp, 'config.json');
      const chatgptFile = join(tmp, 'chatgpt.json');
      execFileSync('mkdir', ['-p', docsDir]);

      console.log('▸ Exporting web app');
      const mobileDir = join(root, 'apps', 'mobile');
      const expoBin = join(findPackage('expo', mobileDir), 'bin', 'cli');
      execFileSync(process.execPath, [expoBin, 'export', '--platform', 'web', '--output-dir', webDir], {
        cwd: mobileDir,
        env: { ...process.env, EXPO_PUBLIC_API_URL: '/api', EXPO_NO_TELEMETRY: '1' },
        stdio: 'inherit',
      });

      const port = await findFreePort();
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`▸ Starting isolated sandbox API on ${baseUrl}`);
      const tsxBin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
      const apiEnv = {
        ...process.env,
        DATABASE_URL: dbUrl,
        PLAID_ENV: 'sandbox',
        PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID || 'sandbox-screenshots',
        PLAID_SANDBOX_SECRET: process.env.PLAID_SANDBOX_SECRET || 'sandbox-screenshots',
        PLAID_PRODUCTION_SECRET: '',
        APP_PASSPHRASE: '',
        APP_PASSPHRASE_HASH: '',
        APP_PASSPHRASE_OFF: '1',
        SESSION_SECRET: 'screenshot-session-secret-0123456789abcdef',
        ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
        ANTHROPIC_API_KEY: '',
        OLLAMA_URL: '',
        API_HOST: '127.0.0.1',
        API_PORT: String(port),
        WEB_DIR: webDir,
        DOCUMENTS_DIR: docsDir,
        MELD_CONFIG_FILE: configFile,
        CHATGPT_AUTH_FILE: chatgptFile,
        MIGRATE_ON_START: '0',
        TAILSCALE_CONTROL: '0',
        PHONE_ACCESS: '0',
      };
      delete apiEnv.SANDBOX_DATABASE_URL;
      delete apiEnv.PRODUCTION_DATABASE_URL;

      apiProc = spawn(tsxBin, [join(root, 'apps', 'api', 'src', 'index.ts')], {
        cwd: join(root, 'apps', 'api'),
        env: apiEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      await waitForHealth(baseUrl, apiProc);
    }

    await assertSandboxData(baseUrl);
    const chatSessionId = await findChatSessionId(baseUrl);

    console.log('▸ Capturing 2x Retina screenshots');
    const captured = await captureAll(baseUrl, chatSessionId, join(tmp, 'chrome-profile'));
    syncHtmlDimensions(captured);
    checkScreenshots();
    console.log('\nReminder: run `npm run site:dev` and inspect callout pins on http://127.0.0.1:8000 if page layouts changed.');
  } finally {
    await terminateProcess(apiProc);
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function resolveSandboxDatabaseUrl() {
  if (process.env.SANDBOX_DATABASE_URL) return process.env.SANDBOX_DATABASE_URL;
  const envPath = join(root, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*SANDBOX_DATABASE_URL\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^['"]|['"]$/g, '');
    }
  }
  return 'postgres://meld:meld@127.0.0.1:5432/meld_sandbox';
}

function assertSandboxDatabaseUrl(dbUrl) {
  const dbName = new URL(dbUrl).pathname.replace(/^\//, '');
  if (!dbName.toLowerCase().includes('sandbox')) {
    throw new Error(`Refusing to capture screenshots from non-sandbox database "${dbName}"`);
  }
}

async function assertSandboxData(baseUrl) {
  const res = await fetch(`${baseUrl}/api/accounts`);
  if (!res.ok) throw new Error(`GET ${baseUrl}/api/accounts failed with ${res.status}`);
  const accounts = await res.json();
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error(`No accounts found in sandbox database at ${baseUrl}. Seed Plaid sandbox first.`);
  }
  const hasSandboxBank = accounts.some((a) => a.institutionName === 'First Platypus Bank');
  if (!hasSandboxBank) {
    throw new Error('Safety check failed: expected Plaid sandbox institution "First Platypus Bank" in /api/accounts.');
  }
}

async function findChatSessionId(baseUrl) {
  const res = await fetch(`${baseUrl}/api/chat/sessions`);
  if (!res.ok) throw new Error(`GET ${baseUrl}/api/chat/sessions failed with ${res.status}`);
  const sessions = await res.json();
  if (!Array.isArray(sessions) || sessions.length === 0) {
    throw new Error('No saved Ask Meld chat session found in sandbox database for ask.png.');
  }
  return sessions[0].id;
}

function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolvePort(port));
    });
    srv.on('error', reject);
  });
}

async function waitForHealth(baseUrl, proc) {
  let stderr = '';
  proc.stderr?.on('data', (d) => { stderr += d.toString(); });
  for (let i = 0; i < 80; i++) {
    if (proc.exitCode !== null) {
      throw new Error(`Sandbox API exited early with code ${proc.exitCode}\n${stderr}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for sandbox API at ${baseUrl}\n${stderr}`);
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

function buildInitScript({ interceptNetWorth = false } = {}) {
  return `(() => {
    try { localStorage.setItem('meld.theme', 'light'); } catch {}
    const RealDate = Date;
    const now = new RealDate();
    const morning = new RealDate(now.getFullYear(), now.getMonth(), now.getDate(), 9, 30, 0, 0).getTime();
    const realStart = RealDate.now();
    const fakeNow = () => morning + (RealDate.now() - realStart);
    class FixedDate extends RealDate {
      constructor(...args) {
        super(...(args.length === 0 ? [fakeNow()] : args));
      }
      static now() { return fakeNow(); }
    }
    window.Date = FixedDate;

    ${
      interceptNetWorth
        ? `
    const origFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      const res = await origFetch(input, init);
      if (!url.includes('/api/networth/history')) return res;
      const raw = await res.clone().json().catch(() => null);
      if (!Array.isArray(raw) || raw.length === 0) return res;
      const last = raw[raw.length - 1];
      const hasCliff = raw.length < 15 || (Math.min(...raw.map((p) => p.netWorth)) < 0 && last.netWorth > 0);
      if (!hasCliff) return res;

      const count = 183;
      const endDate = new RealDate(last.date + 'T00:00:00Z');
      const endAssets = Number(last.assets);
      const endLiab = Number(last.liabilities);
      const startAssets = Math.round((endAssets - 30365) * 100) / 100;
      const startLiab = Math.round((endLiab + 12194) * 100) / 100;
      const points = [];
      for (let i = count; i >= 0; i--) {
        const d = new RealDate(endDate);
        d.setUTCDate(d.getUTCDate() - i);
        const t = (count - i) / count;
        const wave = i === 0 ? 0 : (Math.sin(t * Math.PI * 5.5) * 4200 + Math.cos(t * Math.PI * 11) * 1600) * (1 - Math.pow(t, 6));
        const assets = Math.round((startAssets + (endAssets - startAssets) * t + wave) * 100) / 100;
        const liabilities = Math.round((startLiab + (endLiab - startLiab) * t) * 100) / 100;
        points.push({ date: d.toISOString().slice(0, 10), assets, liabilities, netWorth: Math.round((assets - liabilities) * 100) / 100 });
      }
      return new Response(JSON.stringify(points), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };`
        : ''
    }
  })();`;
}

async function captureShot(cdp, { url, width, height, expectSvg = true, extraMs = 600, interceptNetWorth = false, prepare }) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }, sessionId);
    await cdp.send(
      'Emulation.setEmulatedMedia',
      {
        media: 'screen',
        features: [
          { name: 'prefers-color-scheme', value: 'light' },
          { name: 'prefers-reduced-motion', value: 'reduce' },
        ],
      },
      sessionId,
    );
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: buildInitScript({ interceptNetWorth }) }, sessionId);

    await cdp.send('Page.navigate', { url }, sessionId);
    await waitForPageReady(cdp, sessionId, { expectSvg, extraMs });

    const { result, exceptionDetails } = await cdp.send(
      'Runtime.evaluate',
      { expression: `(${prepare.toString()})()`, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (exceptionDetails) {
      throw new Error(`Prepare script failed for ${url}: ${JSON.stringify(exceptionDetails)}`);
    }
    const clip = result.value;
    if (!clip || clip.width <= 0 || clip.height <= 0) {
      throw new Error(`Invalid screenshot clip for ${url}: ${JSON.stringify(clip)}`);
    }

    const { data } = await cdp.send(
      'Page.captureScreenshot',
      { format: 'png', clip: { ...clip, scale: 1 } },
      sessionId,
    );
    return Buffer.from(data, 'base64');
  } finally {
    await cdp.send('Target.disposeBrowserContext', { browserContextId });
  }
}

async function waitForPageReady(cdp, sessionId, { expectSvg, extraMs }) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const { result } = await cdp.send(
      'Runtime.evaluate',
      {
        expression: `(() => {
          if (document.readyState !== 'complete') return false;
          const text = document.body?.innerText || '';
          if (!text.trim() || text.includes('Loading…') || text.includes('Checking your accounts')) return false;
          if (${expectSvg}) {
            const svgs = [...document.querySelectorAll('svg')];
            if (!svgs.some((s) => s.getBoundingClientRect().width > 100)) return false;
          }
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

async function captureAll(baseUrl, chatSessionId, profileDir) {
  const cdp = await launchCdp(profileDir);
  const results = [];
  try {
    const specs = [
      {
        name: 'home.png',
        url: `${baseUrl}/`,
        width: 1500,
        height: 1800,
        expectSvg: true,
        extraMs: 600,
        interceptNetWorth: true,
        prepare: async () => {
          const texts = (minX = 248) => {
            const out = [];
            const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let n;
            while ((n = w.nextNode())) {
              const t = n.textContent?.trim();
              if (!t || !n.parentElement) continue;
              const r = n.parentElement.getBoundingClientRect();
              if (r.width > 0 && r.height > 0 && r.left >= minX - 5) out.push({ text: t, el: n.parentElement, r });
            }
            return out;
          };
          const hideBtn = texts().find((i) => i.text === 'Hide');
          if (hideBtn) {
            hideBtn.el.click();
            await new Promise((r) => setTimeout(r, 350));
          }
          const items = texts();
          const greeting = items.find((i) => i.text.startsWith('Good'));
          const worthHead = items.find((i) => i.text === 'Worth your attention');
          const comingHead = items.find((i) => i.text === 'Coming up');
          const findCard = (el) => {
            let cur = el;
            while (cur && cur.parentElement) {
              const cs = getComputedStyle(cur);
              if (parseFloat(cs.borderRadius) >= 12 && cur.getBoundingClientRect().width > 350) return cur;
              cur = cur.parentElement;
            }
            return el;
          };
          const worthCard = findCard(worthHead.el);
          const comingCard = findCard(comingHead.el);
          const taskBodies = [...worthCard.querySelectorAll('[role="link"]')];
          const taskRows = taskBodies.map((b) => b.parentElement.getBoundingClientRect());
          const billEls = [...comingCard.querySelectorAll('[tabindex="0"]')]
            .filter((el) => el.innerText.includes('$') && !el.innerText.includes('Recurring'));
          const billRows = billEls.map((el) => el.getBoundingClientRect());
          const row3Prev = billEls[3]?.previousElementSibling;
          const bill4Top = billEls[3]
            ? (row3Prev && !row3Prev.hasAttribute('tabindex') ? row3Prev : billEls[3]).getBoundingClientRect().top
            : 9999;

          const yStart = Math.max(0, Math.round(greeting.r.top) - 24);
          const after2 = Math.max(taskRows[1]?.bottom ?? 0, billRows[2]?.bottom ?? 0) + 18;
          const before3 = Math.min(taskRows[2]?.top ?? 9999, bill4Top) - 10;
          const yEnd = Math.round(Math.min(after2, before3));
          return { x: 248, y: yStart, width: 1252, height: yEnd - yStart };
        },
      },
      {
        name: 'recurring.png',
        url: `${baseUrl}/spending?tab=recurring`,
        width: 1440,
        height: 1400,
        expectSvg: false,
        extraMs: 500,
        prepare: () => {
          const items = [];
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = w.nextNode())) {
            const t = n.textContent?.trim();
            if (!t || !n.parentElement) continue;
            const r = n.parentElement.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && r.left >= 243) items.push({ text: t, el: n.parentElement, r });
          }
          const heading = items.find((i) => i.text === 'Recurring' && i.r.top > 130);
          const comingUp = items.find((i) => i.text === 'Coming up');
          const subsCard = items.find((i) => i.text === 'Subscriptions' && i.r.top > comingUp.r.top);
          const moneyRows = items.filter((i) => i.r.top > comingUp.r.top && i.r.top < (subsCard?.r.top ?? 1400) && i.text.startsWith('$'));
          const yStart = Math.max(0, Math.round(heading.r.top) - 24);
          const yEnd = Math.round((moneyRows[2]?.r.bottom ?? yStart + 866) + 24);
          return { x: 248, y: yStart, width: 1192, height: yEnd - yStart };
        },
      },
      {
        name: 'spending.png',
        url: `${baseUrl}/spending`,
        width: 1520,
        height: 1400,
        expectSvg: true,
        extraMs: 600,
        prepare: () => {
          const items = [];
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = w.nextNode())) {
            const t = n.textContent?.trim();
            if (!t || !n.parentElement) continue;
            const r = n.parentElement.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && r.left >= 243) items.push({ text: t, r });
          }
          const totalSpending = items.find((i) => i.text.includes('Total Spending'));
          const footnote = items.find((i) => i.text.includes('Cash and credit card accounts only'));
          const yStart = Math.max(0, Math.round(totalSpending.r.top) - 42);
          const yEnd = Math.round(footnote ? footnote.r.top - 16 : yStart + 1079);
          return { x: 248, y: yStart, width: 1272, height: yEnd - yStart };
        },
      },
      {
        name: 'accounts.png',
        url: `${baseUrl}/accounts`,
        width: 1520,
        height: 1600,
        expectSvg: true,
        extraMs: 600,
        prepare: () => {
          const items = [];
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = w.nextNode())) {
            const t = n.textContent?.trim();
            if (!t || !n.parentElement) continue;
            const r = n.parentElement.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && r.left >= 243) items.push({ text: t, r });
          }
          const title = items.find((i) => i.text === 'Accounts');
          const plaid401kSub = items.find((i) => i.text.includes('6666') && i.r.top > 900);
          const plaidIra = items.find((i) => i.text === 'Plaid IRA');
          const askInput = items.find((i) => i.text.includes('Ask Meld about your money'));
          const yStart = Math.max(0, Math.round(title.r.top) - 24);
          const maxSafe = Math.min(plaidIra?.r.top ?? 9999, askInput?.r.top ?? 9999) - 10;
          const yEnd = Math.round(Math.min((plaid401kSub?.r.bottom ?? 1230) + 18, maxSafe));
          return { x: 248, y: yStart, width: 1272, height: yEnd - yStart };
        },
      },
      {
        name: 'retirement.png',
        url: `${baseUrl}/plan?tab=retirement`,
        width: 1520,
        height: 2400,
        expectSvg: true,
        extraMs: 800,
        prepare: () => {
          const items = [];
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = w.nextNode())) {
            const t = n.textContent?.trim();
            if (!t || !n.parentElement) continue;
            const r = n.parentElement.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && r.left >= 243) items.push({ text: t, el: n.parentElement, r });
          }
          const findCard = (el) => {
            let cur = el;
            while (cur && cur.parentElement) {
              const cs = getComputedStyle(cur);
              if (parseFloat(cs.borderRadius) >= 12 && cur.getBoundingClientRect().width > 350) return cur;
              cur = cur.parentElement;
            }
            return el;
          };
          const projectedAt = items.find((i) => i.text.startsWith('Projected at'));
          const spendingHead = items.find((i) => i.text === 'Spending in retirement');
          const incomeHead = items.find((i) => i.text === 'Income in retirement');
          const spendingCard = findCard(spendingHead.el);
          const incomeCard = findCard(incomeHead.el);
          const yStart = Math.max(0, Math.round(projectedAt.r.top) - 26);
          const yEnd = Math.round(Math.max(spendingCard.getBoundingClientRect().bottom, incomeCard.getBoundingClientRect().bottom)) + 24;
          return { x: 248, y: yStart, width: 1272, height: yEnd - yStart };
        },
      },
      {
        name: 'tax.png',
        url: `${baseUrl}/plan?tab=tax`,
        width: 1440,
        height: 1400,
        expectSvg: false,
        extraMs: 500,
        prepare: () => {
          const items = [];
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = w.nextNode())) {
            const t = n.textContent?.trim();
            if (!t || !n.parentElement) continue;
            const r = n.parentElement.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && r.left >= 243) items.push({ text: t, el: n.parentElement, r });
          }
          const taxTab = items.find((i) => i.text === 'Tax' && i.r.top < 200);
          const taxes = items.find((i) => i.text === 'Taxes');
          const checklistHead = items.find((i) => i.text.includes('year-end checklist'));
          let checklistCard = checklistHead.el;
          while (checklistCard && checklistCard.parentElement) {
            if (parseFloat(getComputedStyle(checklistCard).borderRadius) >= 12 && checklistCard.getBoundingClientRect().width > 500) break;
            checklistCard = checklistCard.parentElement;
          }
          const underlineBottom = taxTab ? Math.round(taxTab.r.bottom + 8) : 210;
          const yStart = Math.max(underlineBottom + 6, Math.round(taxes.r.top) - 12);
          const cardBottom = checklistCard.getBoundingClientRect().bottom;
          const nextItem = items.find((i) => i.r.top > cardBottom + 4);
          const yEnd = Math.round(Math.min(cardBottom + 14, (nextItem?.r.top ?? 9999) - 6));
          return { x: 248, y: yStart, width: 1192, height: yEnd - yStart };
        },
      },
      {
        name: 'ask.png',
        url: `${baseUrl}/chat/${chatSessionId}`,
        width: 740,
        height: 1800,
        expectSvg: false,
        extraMs: 600,
        prepare: async () => {
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n, emNode = null, endNode = null, lookupNode = null;
          while ((n = w.nextNode())) {
            const t = n.textContent || '';
            if (t.trim() === 'Emergency fund') emNode = n.parentElement;
            if (t.includes('compare if you’d like') || t.includes("compare if you'd like")) endNode = n.parentElement;
            if (t.includes('Checked recurring payments')) lookupNode = n.parentElement;
          }
          if (lookupNode) lookupNode.style.display = 'none';
          let emBlock = emNode;
          while (emBlock.parentElement && emBlock.parentElement.children.length < 5) emBlock = emBlock.parentElement;
          const mdRoot = emBlock.parentElement;
          for (const child of [...mdRoot.children]) {
            if (child === emBlock) break;
            child.style.display = 'none';
          }
          let endBlock = endNode || mdRoot.lastElementChild;
          while (endBlock.parentElement && endBlock.parentElement !== mdRoot) endBlock = endBlock.parentElement;
          await new Promise((r) => setTimeout(r, 100));
          const topRect = emBlock.getBoundingClientRect();
          const botRect = endBlock.getBoundingClientRect();
          const yStart = Math.max(0, Math.round(topRect.top) - 22);
          const yEnd = Math.round(botRect.bottom) + 24;
          return { x: 0, y: yStart, width: 740, height: yEnd - yStart };
        },
      },
    ];

    for (const spec of specs) {
      const buf = await captureShot(cdp, spec);
      const outPath = join(imagesDir, spec.name);
      writeFileSync(outPath, buf);
      const { width: pxW, height: pxH } = readPngDimensions(buf);
      results.push({ name: spec.name, pxW, pxH, bytes: buf.length });
      console.log(`  ✓ ${spec.name.padEnd(15)} ${pxW}×${pxH} (${Math.round(pxW / 2)}×${Math.round(pxH / 2)} @1x, ${Math.round(buf.length / 1024)} KB)`);
    }
  } finally {
    await cdp.close();
  }
  return results;
}

function syncHtmlDimensions(captured) {
  let html = readFileSync(indexHtmlPath, 'utf8');
  for (const { name, pxW, pxH } of captured) {
    const w = Math.round(pxW / 2);
    const h = Math.round(pxH / 2);
    const re = new RegExp(`(<img\\b[^>]*src="images/${escapeRegex(name)}"[^>]*?)\\s+width="\\d+"\\s+height="\\d+"`, 'g');
    html = html.replace(re, `$1 width="${w}" height="${h}"`);
  }
  writeFileSync(indexHtmlPath, html);
}

function checkScreenshots() {
  const errors = [];
  const files = readdirSync(imagesDir);
  for (const f of files) {
    if (/\.jpe?g$/i.test(f)) errors.push(`Stale JPEG screenshot found in site/images/: ${f}`);
  }

  const html = readFileSync(indexHtmlPath, 'utf8');
  const readme = readFileSync(readmePath, 'utf8');
  for (const [label, text] of [['site/index.html', html], ['README.md', readme]]) {
    const badJpg = text.match(/images\/[^\s"'()>]+\.jpe?g/gi);
    if (badJpg) errors.push(`${label} still references JPEG screenshots: ${badJpg.join(', ')}`);
  }

  const htmlImgs = new Map();
  for (const m of html.matchAll(/<img\b[^>]*src="images\/([^"]+)"[^>]*>/g)) {
    const tag = m[0];
    const name = m[1];
    const wm = tag.match(/\bwidth="(\d+)"/);
    const hm = tag.match(/\bheight="(\d+)"/);
    htmlImgs.set(name, { width: wm ? Number(wm[1]) : null, height: hm ? Number(hm[1]) : null });
  }

  for (const [name, minWidth] of Object.entries(MIN_WIDTHS)) {
    const full = join(imagesDir, name);
    if (!existsSync(full)) {
      errors.push(`Missing screenshot: site/images/${name}`);
      continue;
    }
    const buf = readFileSync(full);
    const size = statSync(full).size;
    const { width: pxW, height: pxH } = readPngDimensions(buf);
    if (pxW < minWidth) errors.push(`site/images/${name} width ${pxW}px is below minimum ${minWidth}px (2x Retina)`);
    if (size > MAX_BYTES) errors.push(`site/images/${name} is ${Math.round(size / 1024)} KB (max ${MAX_BYTES / 1024} KB)`);

    const attr = htmlImgs.get(name);
    if (!attr) {
      errors.push(`site/index.html does not reference images/${name}`);
    } else {
      const expW = Math.round(pxW / 2);
      const expH = Math.round(pxH / 2);
      if (attr.width === null || attr.height === null) {
        errors.push(`site/index.html img for images/${name} is missing width/height attributes`);
      } else if (Math.abs(attr.width - expW) > 1 || Math.abs(attr.height - expH) > 1) {
        errors.push(`site/index.html img for images/${name} has ${attr.width}×${attr.height}, expected ${expW}×${expH}`);
      }
    }
  }

  if (errors.length) {
    console.error('Screenshot check failed:\n' + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }
  console.log(`✓ Verified ${Object.keys(MIN_WIDTHS).length} high-res 2x PNG screenshots in site/images/ and dimensions in site/index.html`);
}

function readPngDimensions(buf) {
  const sig = '89504e470d0a1a0a';
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== sig) {
    throw new Error('File is not a valid PNG');
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function findPackage(name, from) {
  for (let dir = from; ; dir = resolve(dir, '..')) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dir === resolve(dir, '..')) throw new Error(`Cannot find package ${name} from ${from}`);
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
