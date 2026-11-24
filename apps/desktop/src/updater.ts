import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Notification, app, ipcMain, webContents, type IpcMainInvokeEvent } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from '@meld/shared';
import { log } from './log';
import { paths } from './paths';

/** First check shortly after launch (once Meld is up), then this often while it runs. */
const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 4 * 60 * 60_000;

export type UpdaterOptions = {
  /** IPC is answered only for pages from here (Meld's own server), not e.g. a Plaid sign-in popup. */
  isTrustedUrl: (url: string) => boolean;
  /** The notification was clicked: show the window on the release notes. */
  showReleases: () => void;
  /** The state changed (the tray's menu follows it). */
  onChange: () => void;
};

/**
 * Updates from GitHub Releases through electron-updater (Squirrel.Mac on macOS). Meld checks on
 * its own and says when there's a new version; downloading starts only when asked, and the
 * downloaded update installs on restart, or on the next quit.
 *
 * `npm run desktop:dev` with MELD_FAKE_UPDATE=0.9.0 walks the same states without a release.
 */
export class Updater {
  private state: UpdateState = { status: 'idle' };
  /** A check the user asked for shows its errors; a background one only logs them. */
  private userCheck = false;
  private readonly fake = process.env.MELD_FAKE_UPDATE;

  constructor(private options: UpdaterOptions) {}

  /** Whether this build can update itself: packaged builds, or a fake update in dev. */
  get enabled() {
    return app.isPackaged || !!this.fake;
  }

  get current(): UpdateState {
    return this.state;
  }

  start() {
    this.registerIpc();
    if (!this.enabled) return;
    if (!this.fake) this.wireAutoUpdater();
    setTimeout(() => void this.check(false), FIRST_CHECK_MS);
    setInterval(() => void this.check(false), CHECK_EVERY_MS).unref();
  }

  async check(user = true) {
    if (!this.enabled) return;
    // Already found, downloading or downloaded: nothing new to learn.
    if (['available', 'downloading', 'ready', 'checking'].includes(this.state.status)) return;
    this.userCheck = user;
    if (this.fake) {
      this.set({ status: 'checking' });
      setTimeout(() => this.found(this.fake!), 600);
      return;
    }
    // Failures arrive as the 'error' event too, handled there.
    await autoUpdater.checkForUpdates().catch(() => {});
  }

  async download() {
    if (this.state.status !== 'available' && !(this.state.status === 'error' && this.state.version)) return;
    const version = this.state.version!;
    this.set({ status: 'downloading', version, percent: 0 });
    if (this.fake) {
      let percent = 0;
      const tick = setInterval(() => {
        percent += 10;
        if (percent < 100) this.set({ status: 'downloading', version, percent });
        else {
          clearInterval(tick);
          this.set({ status: 'ready', version });
        }
      }, 300);
      return;
    }
    await autoUpdater.downloadUpdate().catch(() => {});
  }

  install() {
    if (this.state.status !== 'ready') return;
    log('updater', `Restarting to install ${this.state.version}`);
    if (this.fake) {
      log('updater', 'MELD_FAKE_UPDATE: would quit and install now');
      return;
    }
    autoUpdater.quitAndInstall();
  }

  private wireAutoUpdater() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = {
      info: (m: unknown) => log('updater', String(m)),
      warn: (m: unknown) => log('updater', String(m)),
      error: (m: unknown) => log('updater', String(m)),
      debug: () => {},
    };
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }));
    autoUpdater.on('update-available', (info) => this.found(info.version));
    autoUpdater.on('update-not-available', () => this.set({ status: 'current' }));
    autoUpdater.on('download-progress', (p) => {
      if (this.state.status === 'downloading') this.set({ ...this.state, percent: Math.floor(p.percent) });
    });
    autoUpdater.on('update-downloaded', (info) => this.set({ status: 'ready', version: info.version }));
    autoUpdater.on('error', (err) => {
      log('updater', `Error: ${err.message}`);
      const s = this.state;
      if (s.status === 'downloading') this.set({ status: 'error', version: s.version, message: 'The download didn’t finish. Try again.' });
      else if (this.userCheck) this.set({ status: 'error', message: 'Couldn’t check for updates. Check your connection and try again.' });
      // A background check that failed (offline, say) leaves things as they were.
      else if (s.status === 'checking') this.set({ status: 'idle' });
    });
  }

  private found(version: string) {
    this.set({ status: 'available', version });
    this.notifyOnce(version);
  }

  private set(state: UpdateState) {
    this.state = state;
    for (const contents of webContents.getAllWebContents()) {
      if (!contents.isDestroyed() && this.options.isTrustedUrl(contents.getURL())) contents.send('meld:update-state', state);
    }
    this.options.onChange();
  }

  /** One system notification per new version, so it's seen with the window closed but doesn't nag. */
  private notifyOnce(version: string) {
    const file = path.join(paths.data(), 'update.json');
    let notified = '';
    try {
      notified = (JSON.parse(readFileSync(file, 'utf8')) as { notified?: string }).notified ?? '';
    } catch {
      // First time.
    }
    if (notified === version || !Notification.isSupported()) return;
    try {
      writeFileSync(file, JSON.stringify({ notified: version }));
    } catch {
      // Worst case it's shown again next launch.
    }
    const n = new Notification({ title: `Meld ${version} is available`, body: 'Click to see what’s new and update.' });
    n.on('click', () => {
      this.options.showReleases();
      void this.download();
    });
    n.show();
  }

  private registerIpc() {
    const trusted = (event: IpcMainInvokeEvent | Electron.IpcMainEvent) => this.options.isTrustedUrl(event.senderFrame?.url ?? '');
    ipcMain.on('meld:version', (event) => {
      event.returnValue = trusted(event) ? app.getVersion() : '';
    });
    ipcMain.handle('meld:update-state', (event) => (trusted(event) ? this.state : { status: 'idle' }));
    ipcMain.handle('meld:update-check', (event) => (trusted(event) ? this.check(true) : undefined));
    ipcMain.handle('meld:update-download', (event) => (trusted(event) ? this.download() : undefined));
    ipcMain.handle('meld:update-install', (event) => {
      if (trusted(event)) this.install();
    });
  }
}
