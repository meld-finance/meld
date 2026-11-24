import { spawn } from 'node:child_process';
import { utilityProcess } from 'electron';
import { log } from './log';
import { isDev, paths } from './paths';

/** The API exits with this to be started again, e.g. after settings are saved. */
const RESTART_EXIT_CODE = 75;
const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_POLL_MS = 250;

export type ApiOptions = { env: Record<string, string>; port: number; onCrash: (code: number) => void };

type SpawnedProcess = {
  kill: () => void;
  onceExit: (cb: () => void) => void;
};

/** Runs the Meld API in an Electron utility process (or Node-mode Electron with tsx in dev). */
export class ApiProcess {
  private child: SpawnedProcess | null = null;
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
    const logStream = (stream: { on(event: 'data', cb: (d: Buffer) => void): unknown } | null) => {
      stream?.on('data', (d: Buffer) => log('api', d.toString()));
    };
    const onExit = (code: number | null) => {
      if (this.child === handle) this.child = null;
      if (this.stopping) return;
      if (code === RESTART_EXIT_CODE) {
        log('app', 'API asked to restart');
        this.spawn();
      } else {
        const status = code ?? 1;
        log('app', `API stopped unexpectedly (${status})`);
        this.options.onCrash(status);
      }
    };

    let handle: SpawnedProcess;
    // Electron's utilityProcess ignores `--import tsx`, so dev mode runs Electron in Node mode with tsx;
    // packaged builds run the single bundled JS file inside a utility process.
    if (isDev) {
      const proc = spawn(process.execPath, ['--import', 'tsx', paths.apiEntry()], {
        cwd: paths.apiDir(),
        env: { ...this.options.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      handle = { kill: () => void proc.kill(), onceExit: (cb) => void proc.once('exit', cb) };
      logStream(proc.stdout);
      logStream(proc.stderr);
      proc.on('exit', onExit);
    } else {
      const proc = utilityProcess.fork(paths.apiEntry(), [], {
        cwd: paths.apiDir(),
        env: this.options.env,
        stdio: 'pipe',
        serviceName: 'Meld API',
      });
      handle = { kill: () => void proc.kill(), onceExit: (cb) => void proc.once('exit', cb) };
      logStream(proc.stdout);
      logStream(proc.stderr);
      proc.on('exit', onExit);
    }
    this.child = handle;
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
      child.onceExit(() => resolve());
      child.kill();
    });
  }
}
