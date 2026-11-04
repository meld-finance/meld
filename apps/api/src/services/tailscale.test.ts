import { describe, expect, it } from 'vitest';
import { PhoneAccessService, type RunCli } from './tailscale';

const TARGET = 'http://127.0.0.1:47800';
const running = (certs = true) =>
  JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'mac.tail1.ts.net.' }, CertDomains: certs ? ['mac.tail1.ts.net'] : null });

/** A fake CLI: `status` and `serve status` answers, and a record of every call. */
function fakeCli(status: string | Error, serve: Record<string, unknown> = {}) {
  const calls: string[][] = [];
  let config = serve as { TCP?: Record<string, unknown>; Web?: Record<string, unknown> };
  const run: RunCli = async (args) => {
    calls.push(args);
    if (args[0] === 'status') {
      if (status instanceof Error) throw status;
      return status;
    }
    if (args[1] === 'status') return JSON.stringify(config);
    if (args.includes('--bg')) {
      const port = args.find((a) => a.startsWith('--https='))!.slice(8);
      config = {
        TCP: { ...config.TCP, [port]: { HTTPS: true } },
        Web: { ...config.Web, [`mac.tail1.ts.net:${port}`]: { Handlers: { '/': { Proxy: args.at(-1) } } } },
      };
      return '';
    }
    if (args.at(-1) === 'off') {
      const port = args[1]!.slice(8);
      const web = { ...config.Web };
      delete web[`mac.tail1.ts.net:${port}`];
      config = { ...config, Web: web };
      return '';
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  return { run, calls };
}

describe('PhoneAccessService', () => {
  it('reports Tailscale missing, stopped, or without HTTPS', async () => {
    const missing = Object.assign(new Error('spawn tailscale ENOENT'), { code: 'ENOENT' });
    expect(await new PhoneAccessService(TARGET, fakeCli(missing).run).get()).toEqual({ state: 'not-installed' });
    expect(await new PhoneAccessService(TARGET, fakeCli(JSON.stringify({ BackendState: 'NeedsLogin' })).run).get()).toEqual({
      state: 'not-running',
    });
    expect(await new PhoneAccessService(TARGET, fakeCli(running(false)).run).get()).toEqual({ state: 'no-https', machine: 'mac.tail1.ts.net' });
  });

  it('serves Meld on 443 and turns it off again', async () => {
    const cli = fakeCli(running());
    const phone = new PhoneAccessService(TARGET, cli.run);
    expect(await phone.get()).toEqual({ state: 'off', machine: 'mac.tail1.ts.net' });
    expect(await phone.enable()).toEqual({ state: 'on', machine: 'mac.tail1.ts.net', url: 'https://mac.tail1.ts.net' });
    expect(cli.calls).toContainEqual(['serve', '--bg', '--https=443', TARGET]);
    expect(await phone.disable()).toEqual({ state: 'off', machine: 'mac.tail1.ts.net' });
    expect(cli.calls).toContainEqual(['serve', '--https=443', 'off']);
  });

  it('leaves another service on 443 alone and uses Meld’s port instead', async () => {
    const other = {
      TCP: { '443': { HTTPS: true } },
      Web: { 'mac.tail1.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:8080' } } } },
    };
    const cli = fakeCli(running(), other);
    const phone = new PhoneAccessService(TARGET, cli.run);
    expect(await phone.enable()).toMatchObject({ state: 'on', url: 'https://mac.tail1.ts.net:47800' });
    await phone.disable();
    expect(cli.calls).toContainEqual(['serve', '--https=47800', 'off']);
    expect(cli.calls).not.toContainEqual(['serve', '--https=443', 'off']);
  });

  it('points to the page that turns Serve on for the tailnet', async () => {
    const cli = fakeCli(running());
    const run: RunCli = async (args) => {
      if (args.includes('--bg')) {
        throw Object.assign(new Error('timeout'), { output: 'Serve is not enabled on your tailnet.\nTo enable, visit:\n\n  https://login.tailscale.com/f/serve?node=abc\n' });
      }
      return cli.run(args);
    };
    await expect(new PhoneAccessService(TARGET, run).enable()).rejects.toThrow('https://login.tailscale.com/f/serve?node=abc');
  });
});
