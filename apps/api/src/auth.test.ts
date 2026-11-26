import type { PlaidApi } from 'plaid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOGIN_RATE_LIMIT } from './auth';
import type { Db } from './db/client';
import { loadEnv } from './env';
import { buildServer } from './server';
import type { DocumentStorage } from './storage';

const PASSPHRASE = 'correct horse battery';

describe('POST /auth/login', () => {
  const env = loadEnv({
    DATABASE_URL: 'postgres://unused@127.0.0.1:5432/unused',
    APP_PASSPHRASE: PASSPHRASE,
    SESSION_SECRET: 'x'.repeat(32),
    ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  });
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    // Login never touches the database or Plaid.
    const db = {} as Db;
    const plaid = {} as PlaidApi;
    app = await buildServer({
      env,
      db,
      plaid,
      sync: { db, plaid, encryptionKey: env.ENCRYPTION_KEY },
      ai: null,
      storage: {} as DocumentStorage,
    });
  });
  afterAll(() => app.close());

  const login = (passphrase: string) => app.inject({ method: 'POST', url: '/auth/login', payload: { passphrase } });

  it('issues a token for the right passphrase', async () => {
    const res = await login(PASSPHRASE);
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toEqual(expect.any(String));
  });

  it('reports cloud AI as off when no provider is configured', async () => {
    const { token } = (await login(PASSPHRASE)).json();
    const res = await app.inject({ method: 'GET', url: '/features', headers: { authorization: `Bearer ${token}` } });
    expect(res.json()).toEqual({ cloudAI: false, cloudAIProvider: null, version: expect.any(String) });
  });

  it('rate-limits repeated attempts', async () => {
    // Two attempts were used by the tests above.
    for (let i = 2; i < LOGIN_RATE_LIMIT.max; i++) expect((await login('wrong guess')).statusCode).toBe(401);
    expect((await login('wrong guess')).statusCode).toBe(429);
    // Even the right passphrase waits out the window.
    expect((await login(PASSPHRASE)).statusCode).toBe(429);
  });
});
