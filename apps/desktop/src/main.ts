import { BrowserWindow, Menu, app, dialog, shell } from 'electron';
import { ApiProcess } from './api';
import { log, logFile } from './log';
import { isDev, paths } from './paths';
import { freePort } from './ports';
import { startPostgres, type RunningPostgres } from './postgres';
import { loadSecrets } from './secrets';
import { transfer, type Direction } from './transfer';
import { createTray } from './tray';

/** Meld's usual address, so a phone bookmark (via Tailscale) keeps working; another is picked if it's taken. */
const PREFERRED_PORT = 47800;
/** The API port the Expo dev server talks to. */
const DEV_API_PORT = 4000;
const DEV_WEB_URL = process.env.MELD_WEB_URL ?? 'http://localhost:8081';
/** Plaid Link opens some banks' sign-in in a popup; everything else opens in the browser. */
const POPUP_HOSTS = [/(^|\.)plaid\.com$/];

app.setName('Meld');
if (process.env.MELD_USER_DATA) app.setPath('userData', process.env.MELD_USER_DATA);
else if (isDev) app.setPath('userData', `${app.getPath('appData')}/Meld Dev`);

/** `npm run desktop:seed-from-dev` / `dev:pull-desktop`: copy data to or from the installed app's folder, then exit. */
const transferDirection = process.env.MELD_TRANSFER as Direction | undefined;
if (transferDirection) app.setPath('userData', `${app.getPath('appData')}/Meld`);

let window: BrowserWindow | null = null;
let api: ApiProcess | null = null;
let db: RunningPostgres | null = null;
let appUrl = '';
let quitting = false;

if (transferDirection) runTransfer(transferDirection);
else runApp();

function runTransfer(direction: Direction) {
  if (!app.requestSingleInstanceLock()) {
    console.error('Meld is running. Quit it from the menu bar and try again.');
    app.exit(1);
    return;
  }
  app.dock?.hide();
  void app.whenReady().then(() =>
    transfer(direction).then(
      () => app.exit(0),
      (err: unknown) => {
        console.error(err instanceof Error ? err.message : err);
        app.exit(1);
      },
    ),
  );
}

function page(title: string, body: string) {
  const html = `<!doctype html><meta charset="utf-8"><title>Meld</title>
<style>body{font:15px -apple-system,system-ui;margin:0;height:100vh;display:grid;place-items:center;background:#f7f8fa;color:#1a1d21}
@media (prefers-color-scheme:dark){body{background:#121417;color:#e8eaed}}main{max-width:460px;padding:24px}h1{font-size:20px}p{opacity:.75;line-height:1.5}</style>
<main><h1>${title}</h1>${body}</main>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function showWindow(path = '') {
  if (window) {
    if (path && appUrl) void window.loadURL(appUrl + path);
    window.show();
    window.focus();
    return;
  }
  window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    title: 'Meld',
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => (window = null));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (POPUP_HOSTS.some((h) => h.test(new URL(url).hostname))) return { action: 'allow' };
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (appUrl && url.startsWith(appUrl)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
  void window.loadURL(appUrl ? appUrl + path : page('Starting Meld…', '<p>Getting your data ready.</p>'));
}

function showError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  log('app', `Error: ${message}`);
  showWindow();
  void window?.loadURL(
    page(
      'Meld couldn’t start',
      `<p>${message.replace(/[<>&]/g, '')}</p><p>The log is at ${logFile().replace(/[<>&]/g, '')}. Quit and open Meld again to retry.</p>`,
    ),
  );
}

async function start() {
  const secrets = await loadSecrets();
  db = await startPostgres(secrets.postgresPassword);
  const port = isDev ? DEV_API_PORT : await freePort(PREFERRED_PORT);
  const env: Record<string, string> = {
    // A clean environment: settings come from Meld's own files, not whatever the shell had.
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin',
    HOME: app.getPath('home'),
    TMPDIR: app.getPath('temp'),
    NODE_ENV: isDev ? 'development' : 'production',
    API_HOST: '127.0.0.1',
    API_PORT: String(port),
    PRODUCTION_DATABASE_URL: db.url('meld'),
    SANDBOX_DATABASE_URL: db.url('meld_sandbox'),
    SESSION_SECRET: secrets.sessionSecret,
    ENCRYPTION_KEY: secrets.encryptionKey,
    MELD_CONFIG_FILE: paths.config(),
    DOCUMENTS_DIR: paths.documents(),
    MIGRATE_ON_START: '1',
    MIGRATIONS_DIR: paths.migrations(),
    TAILSCALE_CONTROL: '1',
  };
  if (isDev) env.CORS_ORIGINS = new URL(DEV_WEB_URL).origin;
  else env.WEB_DIR = paths.web();

  api = new ApiProcess({ env, port, onCrash: (code) => showError(new Error(`Meld’s server stopped unexpectedly (${code}).`)) });
  await api.start();
  appUrl = isDev ? DEV_WEB_URL : api.baseUrl;
  log('app', `Meld is running at ${api.baseUrl}`);
  void window?.loadURL(appUrl);
}

async function shutdown() {
  await api?.stop().catch(() => {});
  await db?.stop().catch(() => {});
}

function runApp() {
  if (!app.requestSingleInstanceLock()) app.quit();
  app.on('second-instance', () => showWindow());

  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void shutdown().finally(() => app.exit(0));
  });

  // Closing the window leaves Meld running in the menu bar (phone access keeps working).
  app.on('window-all-closed', () => {});
  app.on('activate', () => showWindow());

  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ]),
    );
    createTray({
      open: () => showWindow(),
      openSettings: () => showWindow('/settings'),
      quit: () => app.quit(),
    });
    showWindow();
    try {
      await start();
    } catch (err) {
      showError(err);
      if (!window) await dialog.showMessageBox({ type: 'error', message: 'Meld couldn’t start', detail: String(err) });
    }
  });
}
