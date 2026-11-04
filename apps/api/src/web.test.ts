import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PlaidApi } from 'plaid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db/client';
import { loadEnv } from './env';
import { buildServer } from './server';
import type { DocumentStorage } from './storage';

describe('serving the web app', () => {
  const webDir = mkdtempSync(path.join(tmpdir(), 'meld-web-'));
  const env = loadEnv({
    DATABASE_URL: 'postgres://unused@127.0.0.1:5432/unused',
    APP_PASSPHRASE: 'correct horse battery',
    SESSION_SECRET: 'x'.repeat(32),
    ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    WEB_DIR: webDir,
  });
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Meld</title>');
    mkdirSync(path.join(webDir, '_expo/static/js'), { recursive: true });
    writeFileSync(path.join(webDir, '_expo/static/js/entry-abc123.js'), 'console.log(1)');
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
  afterAll(async () => {
    await app.close();
    rmSync(webDir, { recursive: true, force: true });
  });

  it('moves the API under /api', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: 'correct horse battery' } });
    expect(login.statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: '/api/alerts' });
    expect(res.statusCode).toBe(401);
  });

  it('loads index.html for app routes, without a login', async () => {
    const res = await app.inject({ method: 'GET', url: '/alerts' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Meld</title>');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('caches hashed bundles forever', async () => {
    const res = await app.inject({ method: 'GET', url: '/_expo/static/js/entry-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('answers unknown API paths with a 404, not the app', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not found' });
  });
});
