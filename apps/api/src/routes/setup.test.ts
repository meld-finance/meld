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
    expect((await app.inject({ method: 'GET', url: '/setup/status' })).json()).toEqual({ configured: false, editable: true, phoneAccess: false, passphrase: true });

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
