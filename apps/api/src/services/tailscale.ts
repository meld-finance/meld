import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { PhoneAccess } from '@meld/shared';
import { HttpError } from '../lib/http';

/** Where the CLI lives: the Mac app (App Store or standalone), Homebrew, the Windows installer, or the PATH. */
const CLI_CANDIDATES =
  process.platform === 'win32'
    ? [`${process.env.ProgramFiles ?? 'C:\\Program Files'}\\Tailscale\\tailscale.exe`]
    : ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale'];
const TIMEOUT_MS = 15_000;
const HTTPS_PORT = 443;
/** Links in Tailscale's own messages, e.g. to turn Serve on for the tailnet. */
const TAILSCALE_LINK = /https:\/\/login\.tailscale\.com\/\S+/;
export const HTTPS_HELP_URL = 'https://tailscale.com/kb/1153/enabling-https';

export type RunCli = (args: string[]) => Promise<string>;

type Status = { BackendState?: string; Self?: { DNSName?: string }; CertDomains?: string[] | null };
type ServeConfig = { TCP?: Record<string, unknown>; Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> };

function findCli(): string {
  return CLI_CANDIDATES.find((p) => existsSync(p)) ?? 'tailscale';
}

/** Runs the Tailscale CLI with fixed arguments (never through a shell). */
export const runCli: RunCli = (args) =>
  new Promise((resolve, reject) => {
    // The Mac app's binary acts as the CLI only when it looks like it's run from a terminal;
    // otherwise it tries to open its window. Apps opened from Finder have no TERM.
    const env = { ...process.env, TERM: process.env.TERM || 'dumb' };
    execFile(findCli(), args, { timeout: TIMEOUT_MS, env }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { output: `${stdout}${stderr}` }));
      else resolve(stdout);
    });
  });

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException).code === 'ENOENT';
const output = (err: unknown) => String((err as { output?: string }).output ?? (err as Error).message ?? '');

/** Turns `tailscale serve` on and off for Meld's local address, leaving anything else it serves alone. */
export class PhoneAccessService {
  constructor(
    /** Where Meld listens, e.g. http://127.0.0.1:47800. */
    private target: string,
    private run: RunCli = runCli,
  ) {}

  private async status(): Promise<Status | null> {
    try {
      return JSON.parse(await this.run(['status', '--json'])) as Status;
    } catch (err) {
      if (isMissing(err)) return null;
      // `status` exits non-zero when logged out but still prints JSON.
      try {
        return JSON.parse(output(err)) as Status;
      } catch {
        return { BackendState: 'Stopped' };
      }
    }
  }

  private async serveConfig(): Promise<ServeConfig> {
    const text = await this.run(['serve', 'status', '--json']);
    return text.trim() ? (JSON.parse(text) as ServeConfig) : {};
  }

  /** HTTPS ports Tailscale serves Meld on (normally just 443). */
  private meldPorts(config: ServeConfig): number[] {
    return Object.entries(config.Web ?? {})
      .filter(([, web]) => Object.values(web.Handlers ?? {}).some((h) => h.Proxy?.replace('localhost', '127.0.0.1') === this.target))
      .map(([hostPort]) => Number(hostPort.split(':').pop()));
  }

  async get(): Promise<PhoneAccess> {
    const status = await this.status();
    if (!status) return { state: 'not-installed' };
    const machine = status.Self?.DNSName?.replace(/\.$/, '');
    if (status.BackendState !== 'Running' || !machine) return { state: 'not-running' };
    if (!status.CertDomains?.length) return { state: 'no-https', machine };
    const ports = this.meldPorts(await this.serveConfig());
    if (!ports.length) return { state: 'off', machine };
    const port = ports.includes(HTTPS_PORT) ? HTTPS_PORT : ports[0]!;
    return { state: 'on', machine, url: port === HTTPS_PORT ? `https://${machine}` : `https://${machine}:${port}` };
  }

  async enable(): Promise<PhoneAccess> {
    const current = await this.get();
    if (current.state === 'on') return current;
    if (current.state === 'not-installed') throw new HttpError(409, 'Install Tailscale on this Mac first.');
    if (current.state === 'not-running') throw new HttpError(409, 'Open Tailscale and sign in first.');
    if (current.state === 'no-https') throw new HttpError(409, 'Turn on HTTPS certificates for your tailnet first.');
    // 443 gives the plainest address; if something else already has it, use Meld's own port number.
    const config = await this.serveConfig();
    const port = config.TCP?.[String(HTTPS_PORT)] ? Number(new URL(this.target).port) : HTTPS_PORT;
    try {
      await this.run(['serve', '--bg', `--https=${port}`, this.target]);
    } catch (err) {
      const link = output(err).match(TAILSCALE_LINK)?.[0];
      throw new HttpError(
        502,
        link
          ? `Tailscale needs Serve turned on for your tailnet. Visit ${link}, then try again.`
          : `Tailscale couldn’t share Meld: ${output(err).trim().split('\n').pop()}`,
      );
    }
    return this.get();
  }

  async disable(): Promise<PhoneAccess> {
    const config = await this.serveConfig().catch(() => ({}));
    for (const port of this.meldPorts(config)) await this.run(['serve', `--https=${port}`, 'off']);
    return this.get();
  }
}
