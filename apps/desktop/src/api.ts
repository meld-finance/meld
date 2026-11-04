import { utilityProcess, type UtilityProcess } from 'electron';
import { log } from './log';
import { isDev, paths } from './paths';

/** The API exits with this to be started again, e.g. after settings are saved. */
const RESTART_EXIT_CODE = 75;
const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_POLL_MS = 250;

export type ApiOptions = { env: Record<string, string>; port: number; onCrash: (code: number) => void };

/** Runs the Meld API in an Electron utility process, starting it again whenever it asks to be. */
export class ApiProcess {
  private child: UtilityProcess | null = null;
  private stopping = false;

  constructor(private options: ApiOptions) {}

  get baseUrl() {
    return `http://127.0.0.1:${this.options.port}`;
  }

  /** Where the API answers: under /api when it serves the web app too. */
  get apiUrl() {
    return isDev ? this.baseUrl : `${this.baseUrl}/api`;
  }

  async start() {
    this.stopping = false;
    this.spawn();
    await this.waitUntilHealthy();
  }

  private spawn() {
    const child = utilityProcess.fork(paths.apiEntry(), [], {
      cwd: paths.apiDir(),
      env: this.options.env,
      // From source in dev; packaged, the API is one bundled file.
      execArgv: isDev ? ['--import', 'tsx'] : [],
      stdio: 'pipe',
      serviceName: 'Meld API',
    });
    child.stdout?.on('data', (d: Buffer) => log('api', d.toString()));
    child.stderr?.on('data', (d: Buffer) => log('api', d.toString()));
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      if (this.stopping) return;
      if (code === RESTART_EXIT_CODE) {
        log('app', 'API asked to restart');
        this.spawn();
      } else {
        log('app', `API stopped unexpectedly (${code})`);
        this.options.onCrash(code);
      }
    });
    this.child = child;
  }

  private async waitUntilHealthy() {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!this.child) throw new Error('Meld’s server stopped while starting. See the log for details.');
      const res = await fetch(`${this.apiUrl}/health`).catch(() => null);
      if (res?.ok) return;
      await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
    }
    throw new Error('Meld’s server didn’t start in time. See the log for details.');
  }

  stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child) return Promise.resolve();
    return new Promise((resolve) => {
      child.once('exit', () => resolve());
      child.kill();
    });
  }
}
