import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_OPENROUTER_MODELS } from '@meld/shared';
import type { PlaidApi } from 'plaid';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSettings, withSettingsFile } from '../config-file';
import type { Db } from '../db/client';
import { loadEnv, setupComplete } from '../env';
import { buildServer, buildSetupServer } from '../server';
import type { PhoneAccessService } from '../services/tailscale';
import type { DocumentStorage } from '../storage';
import type { SettingsDeps } from './setup';

const key = Buffer.alloc(32, 3).toString('base64');
const dir = mkdtempSync(path.join(tmpdir(), 'meld-setup-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const setup = {
  passphrase: 'correct horse battery',
  plaid: { clientId: 'client-id', sandboxSecret: 'sandbox-secret-abcd', productionSecret: '', env: 'sandbox' },
  ai: { anthropicApiKey: '', ollamaUrl: '', ollamaModels: [] },
};

let n = 0;
function source(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgres://unused@127.0.0.1:5432/unused',
    SESSION_SECRET: 'x'.repeat(32),
    ENCRYPTION_KEY: key,
    MELD_CONFIG_FILE: path.join(dir, `config-${n}.json`),
    ...extra,
  };
}

function fullServer(src: NodeJS.ProcessEnv, settings: SettingsDeps) {
  const env = loadEnv(withSettingsFile(src));
  const db = {} as Db;
  const plaid = {} as PlaidApi;
  return buildServer({ env, db, plaid, sync: { db, plaid, encryptionKey: key }, ai: null, storage: {} as DocumentStorage, settings });
}

describe('first-run setup', () => {
  beforeEach(() => void n++);

  it('saves the settings, hashes the passphrase and restarts', async () => {
    const restart = vi.fn();
    const env = loadEnv(source());
    expect(setupComplete(env)).toBe(false);
    const app = await buildSetupServer(env, { fromEnv: new Set(), restart });
    expect((await app.inject({ method: 'GET', url: '/setup/status' })).json()).toEqual({
      configured: false,
      editable: true,
      phoneAccess: false,
      passphrase: true,
      passphraseSet: false,
      desktop: false,
      demo: false,
    });

    const res = await app.inject({ method: 'POST', url: '/setup', payload: setup });
    expect(res.statusCode).toBe(200);
    expect(restart).toHaveBeenCalledOnce();
    const saved = readSettings(env.MELD_CONFIG_FILE, key);
    expect(saved).toMatchObject({ PLAID_CLIENT_ID: 'client-id', PLAID_SANDBOX_SECRET: 'sandbox-secret-abcd', PLAID_ENV: 'sandbox' });
    expect(saved.APP_PASSPHRASE_HASH).toMatch(/^scrypt:/);
    expect(setupComplete(loadEnv(withSettingsFile(source())))).toBe(true);
    await app.close();
  });

  it('can skip the passphrase, leaving every route open', async () => {
    const first = await buildSetupServer(loadEnv(source()), { fromEnv: new Set(), restart: () => {} });
    const { passphrase: _, ...withoutPassphrase } = setup;
    expect((await first.inject({ method: 'POST', url: '/setup', payload: withoutPassphrase })).statusCode).toBe(200);
    await first.close();
    expect(readSettings(loadEnv(source()).MELD_CONFIG_FILE, key)).toMatchObject({ APP_PASSPHRASE_OFF: '1' });

    const app = await fullServer(source(), { fromEnv: new Set(), restart: () => {} });
    expect((await app.inject({ method: 'GET', url: '/setup/status' })).json()).toMatchObject({ configured: true, passphrase: false });
    expect((await app.inject({ method: 'GET', url: '/settings' })).json().passphrase).toBe(false);
    await app.close();
  });

  it('rejects a short passphrase', async () => {
    const app = await buildSetupServer(loadEnv(source()), { fromEnv: new Set(), restart: () => {} });
    const res = await app.inject({ method: 'POST', url: '/setup', payload: { ...setup, passphrase: 'short' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('settings once set up', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let token: string;
  const restart = vi.fn();

  beforeEach(async () => {
    n++;
    const first = await buildSetupServer(loadEnv(source()), { fromEnv: new Set(), restart: () => {} });
    await first.inject({ method: 'POST', url: '/setup', payload: { ...setup, ai: { ...setup.ai, anthropicApiKey: 'sk-ant-secret-wxyz' } } });
    await first.close();
    app = await fullServer(source(), { fromEnv: new Set(), restart });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { passphrase: setup.passphrase } });
    token = login.json().token;
  });
  afterEach(async () => {
    await app.close();
    restart.mockReset();
  });
  const auth = () => ({ authorization: `Bearer ${token}` });

  it('logs in with the saved passphrase and won’t run setup again', async () => {
    expect(token).toEqual(expect.any(String));
    const res = await app.inject({ method: 'POST', url: '/setup', payload: setup });
    expect(res.statusCode).toBe(401);
    const again = await app.inject({ method: 'POST', url: '/setup', payload: setup, headers: auth() });
    expect(again.statusCode).toBe(409);
  });

  it('needs a login to see or test settings', async () => {
    expect((await app.inject({ method: 'GET', url: '/settings' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/setup/test-anthropic', payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/setup/status' })).json().configured).toBe(true);
  });

  it('shows secrets masked', async () => {
    const view = (await app.inject({ method: 'GET', url: '/settings', headers: auth() })).json();
    expect(view.plaid).toEqual({ clientId: 'client-id', sandboxSecret: '••••abcd', productionSecret: '', env: 'sandbox' });
    expect(view.ai.anthropicApiKey).toBe('••••wxyz');
    expect(JSON.stringify(view)).not.toContain('sandbox-secret');
  });

  it('keeps a secret left empty, and changes the passphrase only with the current one', async () => {
    const file = loadEnv(source()).MELD_CONFIG_FILE;
    const plaid = { clientId: 'new-client', sandboxSecret: '', productionSecret: 'prod-secret', env: 'production' };
    expect((await app.inject({ method: 'PUT', url: '/settings', headers: auth(), payload: { plaid } })).statusCode).toBe(200);
    expect(restart).toHaveBeenCalledOnce();
    expect(readSettings(file, key)).toMatchObject({
      PLAID_CLIENT_ID: 'new-client',
      PLAID_SANDBOX_SECRET: 'sandbox-secret-abcd',
      PLAID_PRODUCTION_SECRET: 'prod-secret',
      PLAID_ENV: 'production',
      ANTHROPIC_API_KEY: 'sk-ant-secret-wxyz',
    });

    const wrong = await app.inject({
      method: 'PUT',
      url: '/settings',
      headers: auth(),
      payload: { passphrase: { current: 'not it at all', next: 'a new passphrase' } },
    });
    expect(wrong.statusCode).toBe(400);
  });

  it('turns the passphrase off with the current one, and back on without it', async () => {
    const file = loadEnv(source()).MELD_CONFIG_FILE;
    const off = (current: string) =>
      app.inject({ method: 'PUT', url: '/settings', headers: auth(), payload: { passphrase: { current, next: null } } });
    expect((await off('not it at all')).statusCode).toBe(400);
    expect((await off(setup.passphrase)).statusCode).toBe(200);
    expect(readSettings(file, key).APP_PASSPHRASE_OFF).toBe('1');
    expect(readSettings(file, key).APP_PASSPHRASE_HASH).toBeUndefined();

    await app.close();
    app = await fullServer(source(), { fromEnv: new Set(), restart });
    expect((await app.inject({ method: 'GET', url: '/settings' })).statusCode).toBe(200);
    const on = await app.inject({ method: 'PUT', url: '/settings', payload: { passphrase: { next: 'a new passphrase' } } });
    expect(on.statusCode).toBe(200);
    expect(readSettings(file, key).APP_PASSPHRASE_OFF).toBeUndefined();

    await app.close();
    app = await fullServer(source(), { fromEnv: new Set(), restart });
    expect((await app.inject({ method: 'GET', url: '/settings' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: { passphrase: 'a new passphrase' } })).statusCode).toBe(200);
  });

  it('saves an OpenRouter key encrypted, keeps only non-default models, and removes the key', async () => {
    const file = loadEnv(source()).MELD_CONFIG_FILE;
    const ai = { ...setup.ai, openrouterApiKey: 'sk-or-secret-1234', openrouterModels: ['google/gemini-4-carbon'] };
    expect((await app.inject({ method: 'PUT', url: '/settings', headers: auth(), payload: { ai } })).statusCode).toBe(200);
    expect(readSettings(file, key)).toMatchObject({ OPENROUTER_API_KEY: 'sk-or-secret-1234', OPENROUTER_CHAT_MODELS: 'google/gemini-4-carbon' });
    expect(readFileSync(file, 'utf8')).not.toContain('sk-or-secret');

    await app.close();
    app = await fullServer(source(), { fromEnv: new Set(), restart });
    token = (await app.inject({ method: 'POST', url: '/auth/login', payload: { passphrase: setup.passphrase } })).json().token;
    const view = (await app.inject({ method: 'GET', url: '/settings', headers: auth() })).json();
    expect(view.ai).toMatchObject({ openrouterApiKey: '••••1234', openrouterModels: ['google/gemini-4-carbon'] });

    // The defaults aren't written down, and an empty key field keeps the saved key.
    const defaults = { ...setup.ai, openrouterModels: [...DEFAULT_OPENROUTER_MODELS] };
    expect((await app.inject({ method: 'PUT', url: '/settings', headers: auth(), payload: { ai: defaults } })).statusCode).toBe(200);
    expect(readSettings(file, key).OPENROUTER_CHAT_MODELS).toBeUndefined();
    expect(readSettings(file, key).OPENROUTER_API_KEY).toBe('sk-or-secret-1234');

    const remove = { ...setup.ai, removeOpenRouterKey: true };
    expect((await app.inject({ method: 'PUT', url: '/settings', headers: auth(), payload: { ai: remove } })).statusCode).toBe(200);
    expect(readSettings(file, key).OPENROUTER_API_KEY).toBeUndefined();
    expect(readSettings(file, key).ANTHROPIC_API_KEY).toBe('sk-ant-secret-wxyz');
  });

  it('won’t change settings that come from .env', async () => {
    await app.close();
    app = await fullServer(source({ PLAID_CLIENT_ID: 'env-client' }), { fromEnv: new Set(['PLAID_CLIENT_ID']), restart });
    token = (await app.inject({ method: 'POST', url: '/auth/login', payload: { passphrase: setup.passphrase } })).json().token;
    expect((await app.inject({ method: 'GET', url: '/settings', headers: auth() })).json().fromEnv).toEqual(['plaid']);
    const res = await app.inject({ method: 'PUT', url: '/settings', headers: auth(), payload: { plaid: setup.plaid } });
    expect(res.statusCode).toBe(409);
    expect(restart).not.toHaveBeenCalled();
  });
});

describe('the desktop app', () => {
  const DESKTOP_TOKEN = 'desktop-window-token-0123456789';
  const desktop = () => ({ authorization: `Bearer ${DESKTOP_TOKEN}` });
  beforeEach(() => void n++);

  it('finishes setup from its own window only, with demo data and no passphrase', async () => {
    const restart = vi.fn();
    const env = loadEnv(source({ DESKTOP_TOKEN }));
    const first = await buildSetupServer(env, { fromEnv: new Set(), restart });
    expect((await first.inject({ method: 'GET', url: '/setup/status' })).json()).toMatchObject({ desktop: true, passphraseSet: false });
    // A browser on the same computer can't finish setup for the window.
    expect((await first.inject({ method: 'POST', url: '/setup', payload: {} })).statusCode).toBe(401);
    expect((await first.inject({ method: 'POST', url: '/setup', payload: {}, headers: desktop() })).statusCode).toBe(200);
    await first.close();

    const saved = readSettings(env.MELD_CONFIG_FILE, key);
    expect(saved).toMatchObject({ MELD_DEMO: '1' });
    // No passphrase on the desktop app means only its window gets in, not an open door.
    expect(saved.APP_PASSPHRASE_OFF).toBeUndefined();
    expect(saved.APP_PASSPHRASE_HASH).toBeUndefined();
    expect(setupComplete(loadEnv(withSettingsFile(source({ DESKTOP_TOKEN }))))).toBe(true);
    // The same settings without the desktop app's token aren't enough: there'd be no way in.
    expect(setupComplete(loadEnv(withSettingsFile(source())))).toBe(false);
  });

  it('lets only its own window in until a passphrase is set', async () => {
    const first = await buildSetupServer(loadEnv(source({ DESKTOP_TOKEN })), { fromEnv: new Set(), restart: () => {} });
    await first.inject({ method: 'POST', url: '/setup', payload: {}, headers: desktop() });
    await first.close();

    const app = await fullServer(source({ DESKTOP_TOKEN }), { fromEnv: new Set(), restart: () => {} });
    expect((await app.inject({ method: 'GET', url: '/settings' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/settings', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
    const view = (await app.inject({ method: 'GET', url: '/settings', headers: desktop() })).json();
    expect(view).toMatchObject({ desktop: true, demo: true, passphraseSet: false, plaidReady: false });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { passphrase: 'anything at all' } });
    expect(login.statusCode).toBe(401);
    expect(login.json().error).toMatch(/No passphrase is set/);
    await app.close();
  });

  it('sets and removes the passphrase from its window without the old one', async () => {
    const env = loadEnv(source({ DESKTOP_TOKEN }));
    const first = await buildSetupServer(env, { fromEnv: new Set(), restart: () => {} });
    await first.inject({ method: 'POST', url: '/setup', payload: { passphrase: 'correct horse battery' }, headers: desktop() });
    await first.close();

    let app = await fullServer(source({ DESKTOP_TOKEN }), { fromEnv: new Set(), restart: () => {} });
    // A browser still needs it, and logs in with it.
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: { passphrase: 'correct horse battery' } })).statusCode).toBe(200);
    const change = await app.inject({ method: 'PUT', url: '/settings', headers: desktop(), payload: { passphrase: { next: 'forgot the old one' } } });
    expect(change.statusCode).toBe(200);
    await app.close();

    app = await fullServer(source({ DESKTOP_TOKEN }), { fromEnv: new Set(), restart: () => {} });
    const remove = await app.inject({ method: 'PUT', url: '/settings', headers: desktop(), payload: { passphrase: { next: null } } });
    expect(remove.statusCode).toBe(200);
    const saved = readSettings(env.MELD_CONFIG_FILE, key);
    expect(saved.APP_PASSPHRASE_HASH).toBeUndefined();
    expect(saved.APP_PASSPHRASE_OFF).toBeUndefined();
    await app.close();
  });

  it('switches from demo data to real accounts when Plaid keys are saved', async () => {
    const env = loadEnv(source({ DESKTOP_TOKEN }));
    const first = await buildSetupServer(env, { fromEnv: new Set(), restart: () => {} });
    await first.inject({ method: 'POST', url: '/setup', payload: {}, headers: desktop() });
    await first.close();

    const app = await fullServer(source({ DESKTOP_TOKEN }), { fromEnv: new Set(), restart: () => {} });
    const put = (payload: object) => app.inject({ method: 'PUT', url: '/settings', headers: desktop(), payload });
    expect((await put({ demo: false })).statusCode).toBe(400);
    const plaid = { clientId: 'client-id', sandboxSecret: '', productionSecret: 'prod-secret', env: 'production' };
    expect((await put({ plaid })).statusCode).toBe(200);
    expect(readSettings(env.MELD_CONFIG_FILE, key).MELD_DEMO).toBeUndefined();
    expect((await put({ demo: true })).statusCode).toBe(200);
    expect(readSettings(env.MELD_CONFIG_FILE, key).MELD_DEMO).toBe('1');
    await app.close();
  });
});

describe('demo data and phone access', () => {
  const DESKTOP_TOKEN = 'desktop-window-token-0123456789';
  const headers = { authorization: `Bearer ${DESKTOP_TOKEN}` };
  beforeEach(() => void n++);

  it('won’t start Plaid Link on demo data', async () => {
    const app = await fullServer(source({ DESKTOP_TOKEN, MELD_DEMO: '1' }), { fromEnv: new Set(), restart: () => {} });
    const res = await app.inject({ method: 'POST', url: '/plaid/link-token', headers, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/demo data/);
    await app.close();
  });

  it('won’t turn on phone access until there’s a passphrase to unlock with', async () => {
    const enable = vi.fn(async () => ({ state: 'on' as const, machine: 'mac', url: 'https://mac.ts.net' }));
    const phoneAccess = { enable, disable: vi.fn(), get: vi.fn() } as unknown as PhoneAccessService;
    const build = (extra: NodeJS.ProcessEnv) => {
      const env = loadEnv(withSettingsFile(source({ DESKTOP_TOKEN, MELD_DEMO: '1', TAILSCALE_CONTROL: '1', ...extra })));
      const db = {} as Db;
      const plaid = {} as PlaidApi;
      return buildServer({ env, db, plaid, sync: { db, plaid, encryptionKey: key }, ai: null, storage: {} as DocumentStorage, phoneAccess });
    };
    let app = await build({});
    const turnOn = () => app.inject({ method: 'PUT', url: '/phone-access', headers, payload: { enabled: true } });
    expect((await turnOn()).statusCode).toBe(409);
    expect(enable).not.toHaveBeenCalled();
    await app.close();

    app = await build({ APP_PASSPHRASE: 'correct horse battery' });
    expect((await turnOn()).statusCode).toBe(200);
    expect(enable).toHaveBeenCalledOnce();
    await app.close();
  });
});

describe('host names', () => {
  beforeEach(() => void n++);

  it('refuses requests addressed to a name a web page could point at Meld', async () => {
    const app = await buildSetupServer(loadEnv(source()), { fromEnv: new Set(), restart: () => {} });
    const status = (host: string) => app.inject({ method: 'GET', url: '/setup/status', headers: { host } });
    expect((await status('localhost:47800')).statusCode).toBe(200);
    expect((await status('my-mac.tail1234.ts.net')).statusCode).toBe(200);
    expect((await status('attacker.example.com')).statusCode).toBe(403);
    await app.close();

    const allowed = await buildSetupServer(loadEnv(source({ ALLOWED_HOSTS: 'meld.example.com' })), { fromEnv: new Set(), restart: () => {} });
    expect((await allowed.inject({ method: 'GET', url: '/setup/status', headers: { host: 'meld.example.com' } })).statusCode).toBe(200);
    await allowed.close();
  });
});
