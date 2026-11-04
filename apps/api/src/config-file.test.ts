import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readSettings, settingsFromEnv, withSettingsFile, writeSettings } from './config-file';
import { loadEnv, setupComplete } from './env';

const key = Buffer.alloc(32, 7).toString('base64');
const dir = mkdtempSync(path.join(tmpdir(), 'meld-config-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('settings file', () => {
  const file = path.join(dir, 'config.json');

  it('round-trips settings and keeps secrets encrypted on disk', async () => {
    await writeSettings(file, key, { PLAID_CLIENT_ID: 'client', PLAID_SANDBOX_SECRET: 'sandbox-secret-1234', OLLAMA_URL: '' });
    const raw = readFileSync(file, 'utf8');
    expect(raw).toContain('client');
    expect(raw).not.toContain('sandbox-secret-1234');
    expect(raw).not.toContain('OLLAMA_URL');
    expect(readSettings(file, key)).toEqual({ PLAID_CLIENT_ID: 'client', PLAID_SANDBOX_SECRET: 'sandbox-secret-1234' });
  });

  it('can’t be read with another key', () => {
    expect(() => readSettings(file, Buffer.alloc(32, 8).toString('base64'))).toThrow();
  });

  it('fills in what the environment leaves unset, and the environment wins', () => {
    const merged = withSettingsFile({ MELD_CONFIG_FILE: file, ENCRYPTION_KEY: key, PLAID_CLIENT_ID: 'from-env', PLAID_SANDBOX_SECRET: '' });
    expect(merged.PLAID_CLIENT_ID).toBe('from-env');
    // Empty counts as unset, as in a .env copied from .env.example.
    expect(merged.PLAID_SANDBOX_SECRET).toBe('sandbox-secret-1234');
    expect([...settingsFromEnv({ PLAID_CLIENT_ID: 'x', PLAID_SANDBOX_SECRET: '' })]).toEqual(['PLAID_CLIENT_ID']);
  });

  it('reads as empty when there is no file yet', () => {
    expect(readSettings(path.join(dir, 'missing.json'), key)).toEqual({});
  });
});

describe('setupComplete', () => {
  const base = { DATABASE_URL: 'postgres://u@127.0.0.1/db', SESSION_SECRET: 'x'.repeat(32), ENCRYPTION_KEY: key };

  it('needs a passphrase and the Plaid secret for the environment in use', () => {
    expect(setupComplete(loadEnv(base))).toBe(false);
    expect(setupComplete(loadEnv({ ...base, APP_PASSPHRASE: 'long enough', PLAID_CLIENT_ID: 'c', PLAID_SANDBOX_SECRET: 's' }))).toBe(true);
    expect(
      setupComplete(loadEnv({ ...base, APP_PASSPHRASE_HASH: 'scrypt:a:b', PLAID_CLIENT_ID: 'c', PLAID_SANDBOX_SECRET: 's', PLAID_ENV: 'production' })),
    ).toBe(false);
  });
});
